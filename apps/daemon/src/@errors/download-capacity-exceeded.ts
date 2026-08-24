export class DownloadCapacityExceededError extends Error {
	constructor() {
		super('Maximum number of concurrent downloads reached')
		this.name = 'DownloadCapacityExceededError'
	}
}
