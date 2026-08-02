import type { RecordingStatus, VideoQuality } from './types'

export type RecordingModel = {
	id: string
	streamId: string
	startedAt: Date
	endedAt?: Date
	status: RecordingStatus
	quality: VideoQuality
	storagePath: string
	bytes?: number // o tamanho em bytes
}
