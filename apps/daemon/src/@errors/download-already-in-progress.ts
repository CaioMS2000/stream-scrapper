export class DownloadAlreadyInProgressError extends Error {
	constructor(streamId: string) {
		super(`Download already in progress for stream: ${streamId}`)
		this.name = 'DownloadAlreadyInProgressError'
	}
}
