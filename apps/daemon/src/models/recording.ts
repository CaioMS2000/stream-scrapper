import type { StreamQuality } from './types'

export type RecordingModel = {
	id: string
	streamId: string
	startedAt: Date
	endedAt: Date
	status: string
	quality: StreamQuality
	storagePath: string
	bytes: number
}
