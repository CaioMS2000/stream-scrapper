import { encodeMessage, LineBuffer } from '@repo/ipc'
import type { EventBus } from '@/@shared/events'
import type { DownloadRepository } from '@/application/repositories'
import {
	ExecutorMessage,
	type MaterialMessage,
} from '@/infrastructure/vod-executor'
import { DownloadFailedEvent } from './@events/download-failed'
import { DownloadFinishedEvent } from './@events/download-finished'
import type { DownloadVodParams, VodDownloader } from './types'

export type HttpVodDownloaderProps = {
	bus: EventBus
	downloadRepository: DownloadRepository
	// Fetches de segments em paralelo, por download — repassado pro
	// executor via `material` (ele não lê env/config próprio).
	segmentConcurrency: number
	// Downloads simultâneos (streams diferentes) permitidos ao mesmo tempo.
	maxConcurrentDownloads: number
	// Caminho do entrypoint do executor — sobrescrevível em teste.
	executorEntrypointPath?: string
}

type ActiveDownload = {
	streamId: string
	proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
	totalSegments: number
}

const STDERR_TAIL_MAX = 50
// Renovado a cada `progress` recebido — starting point conservador, não
// calibrado cientificamente (fora de escopo desta fatia, ver
// past conversations/decisoes-downloader.md, "Questões em aberto").
const LEASE_TTL_MS = 2 * 60_000

const DEFAULT_EXECUTOR_ENTRYPOINT_PATH = new URL(
	'../vod-executor/executor-entrypoint.ts',
	import.meta.url
).pathname

// Driven adapter que baixa os segments de um VOD já resolvido — despachante
// central que spawna um child process "burro" por download (mesmo padrão
// já usado por infrastructure/recorder/ pro streamlink, só que agora
// rodando código nosso). Protocolo de 5 mensagens NDJSON pela
// stdin/stdout do child, ver infrastructure/vod-executor/protocol.ts. Ver
// docs/design/002-download-de-vods.md seção D e
// past conversations/decisoes-downloader.md pro raciocínio completo por
// trás desse desenho (child process vs worker thread, cursor durável,
// posse por parentesco de processo).
export class HttpVodDownloader implements VodDownloader {
	// Single source of truth pra "quem está baixando agora" — mesmo padrão
	// do `activeRecordings` do StreamRecorder. jobId === streamId (1:1).
	private readonly activeDownloads = new Map<string, ActiveDownload>()

	constructor(private readonly props: HttpVodDownloaderProps) {}

	hasCapacity(): boolean {
		return this.activeDownloads.size < this.props.maxConcurrentDownloads
	}

	async downloadVod(params: DownloadVodParams): Promise<void> {
		const { streamId, host, baseUrl, segments, destinationPath, resumeFrom } =
			params

		if (this.activeDownloads.has(streamId)) {
			throw new Error(
				`[downloader] download já ativo para streamId ${streamId} — duplicata ignorada`
			)
		}

		const entrypointPath =
			this.props.executorEntrypointPath ?? DEFAULT_EXECUTOR_ENTRYPOINT_PATH

		const proc = Bun.spawn({
			cmd: [process.execPath, 'run', entrypointPath],
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe',
		})

		const entry: ActiveDownload = {
			streamId,
			proc,
			totalSegments: segments.length,
		}
		this.activeDownloads.set(streamId, entry)

		const material: MaterialMessage = {
			type: 'material',
			jobId: streamId,
			host,
			baseUrl,
			segments,
			segmentsFrom: resumeFrom?.segmentIndex ?? 0,
			byteOffsetFrom: resumeFrom?.byteOffset ?? 0,
			destinationPath,
			segmentConcurrency: this.props.segmentConcurrency,
		}
		proc.stdin.write(encodeMessage(material))
		void proc.stdin.flush()

		console.log(
			`[downloader] ${streamId}: executor spawned (pid=${proc.pid}, resumeFrom=${resumeFrom?.segmentIndex ?? 0})`
		)

		void this.consumeStdout(entry, material)
		void this.consumeStderr(proc, streamId)

		void proc.exited.then(exitCode => this.handleExit(streamId, exitCode))
	}

	// Chamado no shutdown do daemon pra não deixar executor órfão de
	// processo — mirror exato de StreamRecorder.stopAll/stopStream. A
	// correção do resume não depende de parada graciosa no meio de um
	// segment: truncate+append no cold resume tolera kill a qualquer
	// momento (ver ResumeOrphanedDownloadsUseCase).
	async stopAll(): Promise<void> {
		const entries = [...this.activeDownloads.values()]
		for (const entry of entries) {
			entry.proc.kill('SIGTERM')
		}
		await Promise.allSettled(entries.map(e => e.proc.exited))
	}

	private async consumeStdout(
		entry: ActiveDownload,
		originalMaterial: MaterialMessage
	): Promise<void> {
		const lineBuffer = new LineBuffer()
		const decoder = new TextDecoder()
		try {
			for await (const chunk of entry.proc.stdout) {
				const lines = lineBuffer.push(decoder.decode(chunk, { stream: true }))
				for (const line of lines) {
					const message = ExecutorMessage.parse(JSON.parse(line))
					await this.handleMessage(entry, originalMaterial, message)
				}
			}
		} catch (error) {
			console.error(
				`[downloader] ${entry.streamId}: erro consumindo stdout do executor:`,
				error
			)
		}
	}

	private async handleMessage(
		entry: ActiveDownload,
		originalMaterial: MaterialMessage,
		message: ExecutorMessage
	): Promise<void> {
		switch (message.type) {
			case 'progress':
				await this.props.downloadRepository
					.updateDownloadByStreamId({
						streamId: entry.streamId,
						segmentIndex: message.segmentIndex,
						byteOffset: message.byteOffset,
						leaseUntil: new Date(Date.now() + LEASE_TTL_MS),
						progress: message.segmentIndex / entry.totalSegments,
					})
					.catch(error => {
						console.error('[downloader] progress update failed:', error)
					})
				break
			case 'need-material': {
				// Reenvia o material já conhecido — nunca re-resolve (ver nota no
				// design doc: segments não parecem exigir auth depois de
				// resolvidos, esperado ficar dormente). `segmentsFrom`/
				// `byteOffsetFrom` são ignorados pelo executor fora do spawn
				// inicial, então reenviar os valores originais é inofensivo.
				entry.proc.stdin.write(encodeMessage(originalMaterial))
				void entry.proc.stdin.flush()
				break
			}
			case 'done':
				await this.props.bus.publish(
					new DownloadFinishedEvent({
						streamId: entry.streamId,
						endedAt: new Date(),
						storagePath: originalMaterial.destinationPath,
						bytes: undefined,
					})
				)
				break
			case 'failed':
				console.error(
					`[downloader] ${entry.streamId}: executor reportou falha:`,
					message.error
				)
				await this.props.bus.publish(
					new DownloadFailedEvent({
						streamId: entry.streamId,
						endedAt: new Date(),
						storagePath: originalMaterial.destinationPath,
						bytes: undefined,
						reason: message.error,
					})
				)
				break
		}
	}

	private async consumeStderr(
		proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>,
		streamId: string
	): Promise<void> {
		const decoder = new TextDecoder()
		const tail: string[] = []
		try {
			for await (const chunk of proc.stderr) {
				const text = decoder.decode(chunk, { stream: true })
				for (const line of text.split('\n')) {
					if (!line) continue
					tail.push(line)
					if (tail.length > STDERR_TAIL_MAX) tail.shift()
				}
			}
		} catch (error) {
			console.error(`[downloader] ${streamId}: erro consumindo stderr:`, error)
		}
		if (tail.length > 0) {
			console.error(`[downloader] ${streamId}: stderr do executor:`, tail)
		}
	}

	private handleExit(streamId: string, exitCode: number | null): void {
		this.activeDownloads.delete(streamId)
		if (exitCode !== 0) {
			// `done`/`failed` já publicaram o evento correspondente na maioria
			// dos casos — isso aqui é rede de segurança pra crash sem mensagem
			// nenhuma (o `download` fica `downloading`, resolvido no próximo
			// boot scan — ver ResumeOrphanedDownloadsUseCase e a decisão de
			// escopo de não respawnar em runtime).
			console.error(
				`[downloader] ${streamId}: executor saiu com código ${exitCode}`
			)
		}
	}
}
