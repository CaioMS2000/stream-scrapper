export class VodDownloadFailedError extends Error {
	constructor(streamId: string, options?: ErrorOptions) {
		super(`Failed to download VOD for stream: ${streamId}`, options)
		this.name = 'VodDownloadFailedError'
	}
}
