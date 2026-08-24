export interface RecordingHandle {
	id: string
	streamId: string
	startedAt: number
	quality: string
	storagePath: string
}

type RecordTwitchStreamParams = {
	filePath: string
	channelName: string
	title: string
	streamId: string
	startedAt: Date
}

export interface TwitchRecorder {
	recordTwitchStream(params: RecordTwitchStreamParams): Promise<RecordingHandle>
	stopStream(username: string): Promise<void>
	isRecording(username: string): boolean
}
