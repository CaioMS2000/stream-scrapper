import type { Event } from '@/@shared/events'

type DownloadFailedEventData = {
	streamId: string
	endedAt: Date
	storagePath: string
	bytes: number | undefined
	reason: string
}

export class DownloadFailedEvent implements Event {
	readonly occurredAt = new Date()

	constructor(private readonly data: DownloadFailedEventData) {}

	get streamId() {
		return this.data.streamId
	}

	get endedAt() {
		return this.data.endedAt
	}

	get storagePath() {
		return this.data.storagePath
	}

	get bytes() {
		return this.data.bytes
	}

	get reason() {
		return this.data.reason
	}
}
