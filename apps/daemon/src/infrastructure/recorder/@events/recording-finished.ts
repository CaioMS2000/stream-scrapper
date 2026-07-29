import type { Event } from '@/@shared/events'

type RecordingFinishedEventData = {
	username: string
	streamId: string
	title: string
	startedAt: Date
	endedAt: Date
	// Dir onde meta.json + stream.ts vivem. Consumidores derivam ambos daqui.
	storagePath: string
	// undefined se o stat do .ts falhou (crash muito precoce, arquivo ausente).
	bytes: number | undefined
}

export class RecordingFinishedEvent implements Event {
	readonly occurredAt = new Date()

	constructor(private readonly data: RecordingFinishedEventData) {}

	get username() {
		return this.data.username
	}

	get streamId() {
		return this.data.streamId
	}

	get title() {
		return this.data.title
	}

	get startedAt() {
		return this.data.startedAt
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
