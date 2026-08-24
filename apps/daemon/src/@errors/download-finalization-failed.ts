export class DownloadFinalizationFailedError extends Error {
	constructor(streamId: string, options?: ErrorOptions) {
		super(`Failed to finalize download for stream: ${streamId}`, options)
		this.name = 'DownloadFinalizationFailedError'
	}
}
