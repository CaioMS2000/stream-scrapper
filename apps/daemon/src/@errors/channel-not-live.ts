export class ChannelNotLiveError extends Error {
	constructor(channel: string) {
		super(`Channel is not live: ${channel}`)
		this.name = 'ChannelNotLiveError'
	}
}
