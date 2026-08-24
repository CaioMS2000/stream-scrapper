import { StreamFinalizationFailedError } from '@/@errors'
import type { StreamMetaStorage } from '@/infrastructure/media-storage'
import { failure, type Result, success } from '@/result'
import type { RecordingRepository } from '../repositories'

type UseCaseProps = {
	streamMetaStorage: StreamMetaStorage
	recordingRepository: RecordingRepository
}

type UseCaseParams = {
	channelName: string
	streamId: string
	storagePath: string
	endedAt: Date
	bytes: number | undefined
	status: 'finished' | 'failed'
}

type UseCaseResponse = Result<StreamFinalizationFailedError, void>

export class FinalizeRecordingUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({
		channelName,
		streamId,
		storagePath,
		endedAt,
		bytes,
		status,
	}: UseCaseParams): Promise<UseCaseResponse> {
		try {
			this.props.streamMetaStorage.updateStreamMeta({
				storagePath,
				patch: { endedAt, bytes, status },
			})
			await this.props.recordingRepository.updateRecordingByStreamId({
				streamId,
				endedAt,
				bytes,
				status,
			})
			return success(undefined)
		} catch (error) {
			return failure(
				new StreamFinalizationFailedError(channelName, { cause: error })
			)
		}
	}
}
