export class StreamStopFailedError extends Error {
	constructor(channel: string, options?: ErrorOptions) {
		super(`Failed to stop recording of: ${channel}`, options)
		this.name = 'StreamStopFailedError'
	}
}
