import { StreamFinalizationFailedError } from '@/@errors'
import type { StreamMetaStorage } from '@/infrastructure/media-storage'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	streamMetaStorage: StreamMetaStorage
}

type UseCaseParams = {
	channelName: string
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
			return success(undefined)
		} catch (error) {
			return failure(
				new StreamFinalizationFailedError(channelName, { cause: error })
			)
		}
	}
}
