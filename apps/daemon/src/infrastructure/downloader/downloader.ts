import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EventBus } from '@/@shared/events'
import type { DownloadRepository } from '@/application/repositories'
import { DownloadFailedEvent } from './@events/download-failed'
import { DownloadFinishedEvent } from './@events/download-finished'
import type { DownloadVodParams, VodDownloader } from './types'

export type HttpVodDownloaderProps = {
	bus: EventBus
	downloadRepository: DownloadRepository
	// Fetches de segments em paralelo, por download.
	segmentConcurrency: number
	// Downloads simultâneos (streams diferentes) permitidos ao mesmo tempo.
	maxConcurrentDownloads: number
}

type ActiveDownload = {
	streamId: string
}

const SEGMENT_RETRY_ATTEMPTS = 3
const SEGMENT_RETRY_BASE_DELAY_MS = 500
const PROGRESS_UPDATE_EVERY_N_SEGMENTS = 10

// Driven adapter que baixa os segments de um VOD já resolvido (via
// infrastructure/cdn-recovery, no caminho implementado hoje) e concatena
// num único `.ts` — mesma forma de infrastructure/recorder/ (interface,
// eventos no bus), mas sem child process supervisionado: é um worker HTTP
// assíncrono dentro do próprio processo do daemon. Ver
// docs/design/002-download-de-vods.md seção D.
export class HttpVodDownloader implements VodDownloader {
	// Single source of truth pra "quem está baixando agora" — mesmo padrão
	// do `activeRecordings` do StreamRecorder.
	private readonly activeDownloads = new Map<string, ActiveDownload>()

	constructor(private readonly props: HttpVodDownloaderProps) {}

	hasCapacity(): boolean {
		return this.activeDownloads.size < this.props.maxConcurrentDownloads
	}

	async downloadVod(params: DownloadVodParams): Promise<void> {
		const { streamId, baseUrl, segments, destinationPath } = params

		if (this.activeDownloads.has(streamId)) {
			throw new Error(
				`[downloader] download já ativo para streamId ${streamId} — duplicata ignorada`
			)
		}

		mkdirSync(destinationPath, { recursive: true })
		const outputPath = `${destinationPath}/stream.ts`

		this.activeDownloads.set(streamId, { streamId })

		// Trabalho em background — não aguardado aqui, mesma assimetria do
		// StreamRecorder.recordTwitchStream (spawna e retorna; a conclusão
		// chega depois via evento no bus, não pelo retorno desta chamada).
		void this.run({ streamId, baseUrl, segments, outputPath }).finally(() => {
			this.activeDownloads.delete(streamId)
		})
	}

	private async run(params: {
		streamId: string
		baseUrl: string
		segments: string[]
		outputPath: string
	}): Promise<void> {
		const { streamId, baseUrl, segments, outputPath } = params
		const storagePath = dirname(outputPath)
		const total = segments.length

		try {
			const { bytes } = await this.downloadSegmentsInOrder({
				baseUrl,
				segments,
				outputPath,
				onProgress: written => {
					// Progresso é reação, não invariante (ver
					// apps/daemon/notes/speculation-early-recorder-invariants-vs-reactions.md)
					// — perder um tick não corrompe nada, então é fire-and-forget e
					// throttled pra não martelar o banco a cada segment.
					if (
						written % PROGRESS_UPDATE_EVERY_N_SEGMENTS !== 0 &&
						written !== total
					) {
						return
					}
					void this.props.downloadRepository
						.updateDownloadByStreamId({ streamId, progress: written / total })
						.catch(error => {
							console.error('[downloader] progress update failed:', error)
						})
				},
			})

			await this.props.bus.publish(
				new DownloadFinishedEvent({
					streamId,
					endedAt: new Date(),
					storagePath,
					bytes,
				})
			)
		} catch (error) {
			console.error(`[downloader] ${streamId}: download falhou:`, error)
			await this.props.bus.publish(
				new DownloadFailedEvent({
					streamId,
					endedAt: new Date(),
					storagePath,
					bytes: undefined,
					reason: error instanceof Error ? error.message : String(error),
				})
			)
		}
	}

	// Baixa segments com um pool limitado de workers concorrentes, mas
	// escreve no arquivo de saída ESTRITAMENTE em ordem — um buffer indexado
	// segura segments que chegaram fora de ordem até o próximo índice
	// pendente completar, então escreve e libera da memória. Concatenação
	// direta de `.ts` é segura (MPEG-TS é auto-contido por design, mesma
	// premissa da ADR 004).
	private async downloadSegmentsInOrder(params: {
		baseUrl: string
		segments: string[]
		outputPath: string
		onProgress?: (written: number, total: number) => void
	}): Promise<{ bytes: number }> {
		const { baseUrl, segments, outputPath, onProgress } = params
		const concurrency = Math.max(1, this.props.segmentConcurrency)

		const file = Bun.file(outputPath)
		const writer = file.writer()

		const pending = new Map<number, Uint8Array>()
		let nextToWrite = 0
		let nextToFetch = 0
		let totalBytes = 0

		const drain = () => {
			while (pending.has(nextToWrite)) {
				const chunk = pending.get(nextToWrite)
				if (!chunk) break
				pending.delete(nextToWrite)
				writer.write(chunk)
				totalBytes += chunk.byteLength
				nextToWrite++
				onProgress?.(nextToWrite, segments.length)
			}
		}

		const worker = async () => {
			while (true) {
				// Sem `await` entre leitura e incremento — seguro mesmo com
				// múltiplos workers concorrentes (JS é single-threaded).
				const index = nextToFetch++
				if (index >= segments.length) return

				const segmentUrl = `${baseUrl}/${segments[index]}`
				const bytes = await this.fetchSegmentWithRetry(segmentUrl)
				pending.set(index, bytes)
				drain()
			}
		}

		const workerCount = Math.min(concurrency, segments.length)
		await Promise.all(Array.from({ length: workerCount }, () => worker()))

		await writer.end()

		return { bytes: totalBytes }
	}

	private async fetchSegmentWithRetry(url: string): Promise<Uint8Array> {
		let lastError: unknown

		for (let attempt = 1; attempt <= SEGMENT_RETRY_ATTEMPTS; attempt++) {
			try {
				const response = await fetch(url)
				if (!response.ok) {
					throw new Error(`segment fetch failed: ${response.status} ${url}`)
				}
				return new Uint8Array(await response.arrayBuffer())
			} catch (error) {
				lastError = error
				if (attempt < SEGMENT_RETRY_ATTEMPTS) {
					await Bun.sleep(SEGMENT_RETRY_BASE_DELAY_MS * attempt)
				}
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}
}
