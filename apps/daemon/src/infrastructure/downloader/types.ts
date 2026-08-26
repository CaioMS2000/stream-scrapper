export type DownloadVodParams = {
	streamId: string
	host: string
	baseUrl: string
	segments: string[]
	// Pasta onde o `.ts` final deve ser salvo — vem de
	// MediaStorage.createStreamPath, mesma pasta usada pela gravação ao vivo.
	destinationPath: string
	// Presente só no cold resume (ResumeOrphanedDownloadsUseCase) — de onde
	// o executor deve continuar em vez de começar do zero. Ver
	// past conversations/decisoes-downloader.md §7-8.
	resumeFrom?: {
		segmentIndex: number
		byteOffset: number
	}
}

export interface VodDownloader {
	hasCapacity(): boolean
	downloadVod(params: DownloadVodParams): Promise<void>
}
