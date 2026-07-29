export class StreamFinalizationFailedError extends Error {
	constructor(channel: string, options?: ErrorOptions) {
		super(`Failed to finalize recording of: ${channel}`, options)
		this.name = 'StreamFinalizationFailedError'
	}
}
