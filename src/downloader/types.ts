import type { DownloadSource, DownloadStatus } from '../store'
import type { Manifest } from '../twitch'

// Reusa os unions do store (fonte única) pra não duplicar.
export type { DownloadSource, DownloadStatus }

export interface DownloadHandle {
	id: string
	streamId: string
	source: DownloadSource
	status: DownloadStatus
	progress: number
	storagePath: string | null
}

// A estratégia de download fica atrás de interface (trocável): FfmpegStrategy
// (MVP) hoje, ParallelSegmentStrategy (upgrade) depois — sem mexer no resto.
export interface DownloadStrategy {
	download(
		mediaPlaylistUrl: string,
		outputPath: string,
		opts?: { durationSeconds?: number }
	): Promise<void>
}

export interface DownloadOpts {
	quality?: string // 'best' (padrão), 'chunked', '720p'…
	durationSeconds?: number // -t no ffmpeg (baixa só um trecho)
}

// Contrato público. O downloader recebe o Manifest JÁ resolvido (Modulo_Downloader
// §7): fica burro (baixa + arquiva); a escolha caminho 1/2 vive no chamador.
export interface Downloader {
	download(
		streamId: string,
		manifest: Manifest,
		opts?: DownloadOpts
	): Promise<DownloadHandle>
}
