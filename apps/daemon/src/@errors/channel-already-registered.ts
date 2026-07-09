export class ChannelAlreadyRegisteredError extends Error {
	constructor(channel: string) {
		super(`Channel already registred: ${channel}`)
		this.name = 'ChannelAlreadyRegisteredError'
	}
}
