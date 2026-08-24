import type { RecordingModel } from '@/application/models'

export type CreateRecordingParams = {
	streamId: RecordingModel['streamId']
	startedAt: RecordingModel['startedAt']
	status: RecordingModel['status']
	quality: RecordingModel['quality']
	storagePath: RecordingModel['storagePath']
	bytes?: RecordingModel['bytes']
}

export type UpdateRecordingParams = {
	streamId: RecordingModel['streamId']
	endedAt?: RecordingModel['endedAt']
	status?: RecordingModel['status']
	bytes?: RecordingModel['bytes']
}

export interface RecordingRepository {
	createRecording(params: CreateRecordingParams): Promise<RecordingModel>
	updateRecordingByStreamId(
		params: UpdateRecordingParams
	): Promise<RecordingModel>
	findRecordingByStreamId(streamId: string): Promise<RecordingModel | null>
}
