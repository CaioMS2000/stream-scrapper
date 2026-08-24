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
	// Espelha o `activeRecordings` do StreamRecorder real. Testes que
	// precisam simular "canal gravando agora" sem rodar o fluxo completo de
	// start-recording podem semear direto: `recorder.recording.add('lexi')`.
	readonly recording = new Set<string>()

	constructor(private readonly config: FakeRecorderConfig = {}) {}

	async recordTwitchStream(params: RecordCall): Promise<RecordingHandle> {
		if (this.config.throwOnRecord) {
			throw this.config.throwOnRecord
		}
		this.recordCalls.push(params)
		this.recording.add(params.channelName.toLowerCase())
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
		this.recording.delete(username.toLowerCase())
	}

	isRecording(username: string): boolean {
		return this.recording.has(username.toLowerCase())
	}
}
