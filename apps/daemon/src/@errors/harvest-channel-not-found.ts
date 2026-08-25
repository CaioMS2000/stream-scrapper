export class HarvestChannelNotFoundError extends Error {
	constructor(channel: string) {
		super(`Harvest channel not found: ${channel}`)
		this.name = 'HarvestChannelNotFoundError'
	}
}
