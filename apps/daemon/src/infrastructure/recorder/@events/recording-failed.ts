import type { Event } from '@/@shared/events'

type RecordingFailedEventData = {
	username: string
	streamId: string
	title: string
	startedAt: Date
	endedAt: Date
	storagePath: string
	bytes: number | undefined
	// Diagnóstico do processo: consumidores futuros (webhook, alerting)
	// podem usar; o FinalizeRecordingUseCase ignora e só marca status=failed.
	exitCode: number | null
	stderrTail: string[]
}

export class RecordingFailedEvent implements Event {
	readonly occurredAt = new Date()

	constructor(private readonly data: RecordingFailedEventData) {}

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

	get exitCode() {
		return this.data.exitCode
	}

	get stderrTail() {
		return this.data.stderrTail
	}
}
