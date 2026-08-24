export type DownloadVodParams = {
	streamId: string
	baseUrl: string
	segments: string[]
	// Pasta onde o `.ts` final deve ser salvo — vem de
	// MediaStorage.createStreamPath, mesma pasta usada pela gravação ao vivo.
	destinationPath: string
}

export interface VodDownloader {
	hasCapacity(): boolean
	downloadVod(params: DownloadVodParams): Promise<void>
}
