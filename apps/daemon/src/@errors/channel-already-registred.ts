export class ChannelAlreadyRegistreError extends Error {
	constructor(channel: string) {
		super(`Channel already registred: ${channel}`)
		this.name = 'ChannelAlreadyRegistreError'
	}
}
