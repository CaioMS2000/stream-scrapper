import type { RecordingStatus, VideoQuality } from './types'

export type RecordingModel = {
	id: string
	streamId: string
	startedAt: Date
	endedAt: Date | null
	status: RecordingStatus
	quality: VideoQuality
	storagePath: string
	bytes: number | null // o tamanho em bytes
}
