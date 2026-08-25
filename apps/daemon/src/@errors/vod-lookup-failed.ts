export class VodLookupFailedError extends Error {
	constructor(streamId: string, options?: ErrorOptions) {
		super(`Failed to look up VOD for stream: ${streamId}`, options)
		this.name = 'VodLookupFailedError'
	}
}
