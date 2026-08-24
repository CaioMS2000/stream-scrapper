import {
	ChannelNotFoundError,
	ChannelRecordingInProgressError,
} from '@/@errors'
import type { ChannelRepository } from '@/application/repositories'
import type { TwitchRecorder } from '@/infrastructure/recorder'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	channelRepository: ChannelRepository
	recorder: TwitchRecorder
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<
	ChannelNotFoundError | ChannelRecordingInProgressError,
	void
>

export class RemoveChannelUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const existingChannel =
			await this.props.channelRepository.findChannel(channelName)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channelName))
		}

		if (this.props.recorder.isRecording(channelName)) {
			return failure(new ChannelRecordingInProgressError(channelName))
		}

		await this.props.channelRepository.deleteChannel(channelName)

		return success(undefined)
	}
}
