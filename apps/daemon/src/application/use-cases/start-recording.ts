import { StreamRecordingFailedError } from '@/@errors'
import type {
	MediaStorage,
	StreamMetaStorage,
} from '@/infrastructure/media-storage'
import type { TwitchRecorder } from '@/infrastructure/recorder'
import { failure, type Result, success } from '@/result'
import type { StreamRepository } from '../repositories'

type UseCaseProps = {
	streamRepository: StreamRepository
	storage: MediaStorage
	recorder: TwitchRecorder
	streamMetaStorage: StreamMetaStorage
}

type UseCaseParams = {
	channelName: string
	streamId: string
	title: string
	startedAt: Date
}

type UseCaseResponse = Result<StreamRecordingFailedError, void>

export class StartRecordingUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({
		channelName,
		streamId,
		title,
		startedAt,
	}: UseCaseParams): Promise<UseCaseResponse> {
		try {
			await this.props.streamRepository.createStream({
				streamId,
				channelName,
				startedAt,
				title,
			})
			const { fullPath } = this.props.storage.createStreamPath({
				channelName,
				streamId,
				title,
				startedAt,
			})
			const metaFile = this.props.streamMetaStorage.toMetaFile({
				channelName,
				title,
				streamId,
				startedAt,
				endedAt: undefined,
				status: 'recording',
				quality: 'source',
				bytes: undefined,
			})

			this.props.streamMetaStorage.writeStreamMeta({
				metaFile,
				storagePath: fullPath,
			})
			await this.props.recorder.recordTwitchStream({
				channelName,
				streamId,
				startedAt,
				title,
				filePath: fullPath,
			})

			return success(undefined)
		} catch (error) {
			return failure(
				new StreamRecordingFailedError(channelName, { cause: error })
			)
		}
	}
}
