import type {
	DownloadVodParams,
	VodDownloader,
} from '../infrastructure/downloader'

type FakeVodDownloaderConfig = {
	hasCapacity?: boolean
	throwOnDownload?: Error
}

// Fake da VodDownloader pra unit tests dos use cases. Guarda o que foi
// chamado e permite forçar branch de failure/capacidade cheia via config.
// Zero I/O — não faz fetch nem toca no filesystem.
export class FakeVodDownloader implements VodDownloader {
	readonly downloadCalls: DownloadVodParams[] = []

	constructor(private readonly config: FakeVodDownloaderConfig = {}) {}

	hasCapacity(): boolean {
		return this.config.hasCapacity ?? true
	}

	async downloadVod(params: DownloadVodParams): Promise<void> {
		if (this.config.throwOnDownload) {
			throw this.config.throwOnDownload
		}
		this.downloadCalls.push(params)
	}
}
