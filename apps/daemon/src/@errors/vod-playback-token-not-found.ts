export class VodPlaybackTokenNotFoundError extends Error {
	constructor(vodId: string) {
		super(`VOD playback token not found: ${vodId}`)
		this.name = 'VodPlaybackTokenNotFoundError'
	}
}
