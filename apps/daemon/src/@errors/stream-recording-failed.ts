export class StreamRecordingFailedError extends Error {
	constructor(channel: string, options?: ErrorOptions) {
		super(`Failed to record stream of: ${channel}`, options)
		this.name = 'StreamRecordingFailedError'
	}
}
