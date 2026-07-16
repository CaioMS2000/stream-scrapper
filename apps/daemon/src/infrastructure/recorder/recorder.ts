import type { MediaStorage } from '@/infrastructure/media-storage'
import type { TwitchClient } from '@/infrastructure/twitch/client'
import type { TwitchRecorder } from './types'

export type StreamRecorderProps = {
	twitch: TwitchClient
	storage: MediaStorage
	streamlinkBinPath: string
}

type ExitReason =
	| { kind: 'stopped-by-us' }
	| { kind: 'stream-ended' }
	| {
			kind: 'error'
			exitCode: number | null
			signalCode: NodeJS.Signals | number | null
			stderrTail: string[]
	  }

type ActiveRecording = {
	proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>
	stopRequested: boolean
	// Ring buffer das últimas ~50 linhas de stderr. Barato de manter em live
	// longa, ouro pra diagnóstico em caso de erro (ver handleExit).
	stderrTail: string[]
	// Fallback SIGKILL agendado por stopStream. handleExit cancela quando o
	// processo finalmente sai.
	killTimer: Timer | null
}

const STDERR_TAIL_MAX = 50
const SIGKILL_FALLBACK_MS = 10_000

export class StreamRecorder implements TwitchRecorder {
	// Single source of truth pra "quem está gravando agora". Chave é o username
	// em lowercase (mesma normalização usada no ChannelMonitor).
	private readonly activeRecordings = new Map<string, ActiveRecording>()

	constructor(private readonly props: StreamRecorderProps) {}

	recordTwitchStream: TwitchRecorder['recordTwitchStream'] = async ({
		channelName,
		streamId,
		startedAt,
		title,
		filePath,
	}) => {
		const key = channelName.toLowerCase()

		if (this.activeRecordings.has(key)) {
			throw new Error(
				`[recorder] gravação já ativa para ${channelName} — duplicata ignorada`
			)
		}

		// Um arquivo por folder — a MediaStorage já criou a pasta única (com
		// título/data/streamId no path). Se um dia precisar de múltiplas
		// tentativas por live, muda aqui.
		const outputPath = `${filePath}/stream.ts`
		const url = `https://twitch.tv/${channelName}`

		const proc = Bun.spawn({
			cmd: [
				this.props.streamlinkBinPath,
				url,
				'best',
				'-o',
				outputPath,
				'--twitch-disable-ads',
			],
			stdout: 'ignore',
			stderr: 'pipe',
		})

		const entry: ActiveRecording = {
			proc,
			stopRequested: false,
			stderrTail: [],
			killTimer: null,
		}
		this.activeRecordings.set(key, entry)

		// Consumidores em background — sem await pra não segurar o retorno da
		// função. handleExit é quem limpa o entry no map.
		void this.consumeStderr(proc, entry)
		void proc.exited.then(exitCode => this.handleExit(key, exitCode))

		console.log(
			`[recorder] ${channelName}: streamlink spawned (pid=${proc.pid}, output=${outputPath})`
		)

		return {
			id: proc.pid.toString(),
			streamId,
			startedAt: startedAt.getTime(),
			quality: 'best',
			storagePath: outputPath,
		}
	}

	stopStream: TwitchRecorder['stopStream'] = async username => {
		const key = username.toLowerCase()
		const entry = this.activeRecordings.get(key)
		if (!entry) {
			console.warn(
				`[recorder] stopStream: nenhuma gravação ativa para ${username}`
			)
			return
		}

		entry.stopRequested = true
		entry.proc.kill('SIGTERM')

		// SIGTERM deixa streamlink fechar o `.ts` limpo. Se travar por 10s,
		// força SIGKILL (arquivo pode ficar meio-finalizado, mas melhor que
		// zumbi indefinido). handleExit cancela o timer se sair antes.
		entry.killTimer = setTimeout(() => {
			console.warn(
				`[recorder] ${username}: não terminou em ${SIGKILL_FALLBACK_MS / 1000}s após SIGTERM, enviando SIGKILL`
			)
			entry.proc.kill('SIGKILL')
		}, SIGKILL_FALLBACK_MS)
	}

	// Chamado no shutdown do daemon pra não deixar streamlink órfão.
	async stopAll(): Promise<void> {
		const usernames = [...this.activeRecordings.keys()]
		await Promise.all(usernames.map(u => this.stopStream(u)))
	}

	private handleExit(key: string, exitCode: number | null): void {
		const entry = this.activeRecordings.get(key)
		if (!entry) return

		if (entry.killTimer) clearTimeout(entry.killTimer)
		this.activeRecordings.delete(key)

		// "Nós paramos" vs "acabou sozinho" vem do stopRequested, NÃO do
		// exit code — SIGTERM em streamlink pode sair não-zero mesmo tendo
		// finalizado o arquivo. Combinar as duas fontes evita falso-positivo
		// de "erro" toda vez que o Monitor detecta offline.
		const reason: ExitReason = entry.stopRequested
			? { kind: 'stopped-by-us' }
			: exitCode === 0
				? { kind: 'stream-ended' }
				: {
						kind: 'error',
						exitCode,
						signalCode: entry.proc.signalCode,
						stderrTail: entry.stderrTail,
					}

		switch (reason.kind) {
			case 'stopped-by-us':
				console.log(
					`[recorder] ${key}: parada solicitada (streamlink encerrado)`
				)
				break
			case 'stream-ended':
				console.log(
					`[recorder] ${key}: live terminou naturalmente (streamlink exit 0)`
				)
				break
			case 'error':
				console.error(
					`[recorder] ${key}: streamlink falhou (exit=${reason.exitCode}, signal=${reason.signalCode}). Últimas linhas de stderr:\n${reason.stderrTail.join('\n')}`
				)
				break
		}
	}

	private async consumeStderr(
		proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>,
		entry: ActiveRecording
	): Promise<void> {
		const decoder = new TextDecoder()
		let leftover = ''
		try {
			for await (const chunk of proc.stderr) {
				const text = leftover + decoder.decode(chunk, { stream: true })
				const lines = text.split('\n')
				leftover = lines.pop() ?? ''
				for (const line of lines) {
					entry.stderrTail.push(line)
					if (entry.stderrTail.length > STDERR_TAIL_MAX) {
						entry.stderrTail.shift()
					}
				}
			}
			if (leftover) entry.stderrTail.push(leftover)
		} catch (error) {
			console.error('[recorder] consumeStderr failed:', error)
		}
	}
}
