import type { Event } from '@/@shared/events'

type DownloadFinishedEventData = {
	streamId: string
	endedAt: Date
	storagePath: string
	bytes: number | undefined
}

export class DownloadFinishedEvent implements Event {
	readonly occurredAt = new Date()

	constructor(private readonly data: DownloadFinishedEventData) {}

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
}
