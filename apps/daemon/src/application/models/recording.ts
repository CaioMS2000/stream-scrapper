import type { RecordingStatus, StreamQuality } from './types'

export type RecordingModel = {
	id: string
	streamId: string
	startedAt: Date
	endedAt: Date
	status: RecordingStatus
	quality: StreamQuality
	storagePath: string
	bytes: number
}
