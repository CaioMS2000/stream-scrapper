export class ChannelNotFoundError extends Error {
	constructor(channel: string) {
		super(`Channel not found: ${channel}`)
		this.name = 'ChannelNotFoundError'
	}
}
