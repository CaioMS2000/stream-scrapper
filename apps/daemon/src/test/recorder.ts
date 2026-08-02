import type {
	RecordingHandle,
	TwitchRecorder,
} from '../infrastructure/recorder'

type RecordCall = {
	channelName: string
	streamId: string
	title: string
	startedAt: Date
	filePath: string
}

type FakeRecorderConfig = {
	throwOnRecord?: Error
	throwOnStop?: Error
}

// Fake da TwitchRecorder pra unit tests dos use cases. Guarda o que foi
// chamado e permite forçar branch de failure via `throwOnRecord/Stop`.
// Zero I/O — não spawna streamlink nem toca no filesystem.
export class FakeRecorder implements TwitchRecorder {
	readonly recordCalls: RecordCall[] = []
	readonly stopCalls: string[] = []

	constructor(private readonly config: FakeRecorderConfig = {}) {}

	async recordTwitchStream(params: RecordCall): Promise<RecordingHandle> {
		if (this.config.throwOnRecord) {
			throw this.config.throwOnRecord
		}
		this.recordCalls.push(params)
		return {
			id: `fake-${params.streamId}`,
			streamId: params.streamId,
			startedAt: params.startedAt.getTime(),
			quality: 'source',
			storagePath: params.filePath,
		}
	}

	async stopStream(username: string): Promise<void> {
		if (this.config.throwOnStop) {
			throw this.config.throwOnStop
		}
		this.stopCalls.push(username)
	}
}
