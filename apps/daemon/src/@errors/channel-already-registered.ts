export class ChannelAlreadyRegisteredError extends Error {
	constructor(channel: string) {
		super(`Channel already registered: ${channel}`)
		this.name = 'ChannelAlreadyRegisteredError'
	}
}
