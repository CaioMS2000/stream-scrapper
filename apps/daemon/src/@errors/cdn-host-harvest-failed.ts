export class CdnHostHarvestFailedError extends Error {
	constructor(channelName: string, options?: ErrorOptions) {
		super(`Failed to harvest cdn host for channel: ${channelName}`, options)
		this.name = 'CdnHostHarvestFailedError'
	}
}
