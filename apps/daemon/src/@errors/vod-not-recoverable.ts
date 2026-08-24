export class VodNotRecoverableError extends Error {
	constructor(streamId: string) {
		super(`Could not recover VOD for stream via CDN: ${streamId}`)
		this.name = 'VodNotRecoverableError'
	}
}
