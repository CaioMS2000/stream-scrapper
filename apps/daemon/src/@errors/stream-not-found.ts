export class StreamNotFoundError extends Error {
	constructor(streamId: string) {
		super(`Stream not found: ${streamId}`)
		this.name = 'StreamNotFoundError'
	}
}
