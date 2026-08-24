import {
	ChannelNotFoundError,
	ChannelNotLiveError,
	type StreamRecordingFailedError,
} from '@/@errors'
import type { ChannelRepository } from '@/application/repositories'
import type { TwitchClient } from '@/infrastructure/twitch/client'
import { failure, type Result } from '@/result'
import type { StartRecordingUseCase } from './start-recording'

type UseCaseProps = {
	channelRepository: ChannelRepository
	twitch: TwitchClient
	startRecording: StartRecordingUseCase
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<
	ChannelNotFoundError | ChannelNotLiveError | StreamRecordingFailedError,
	void
>

export class ForceRecordUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const existingChannel =
			await this.props.channelRepository.findChannel(channelName)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channelName))
		}

		const twitchResult = await this.props.twitch.getChannel(channelName)

		if (twitchResult.isFailure()) {
			return failure(twitchResult.value)
		}

		const { stream } = twitchResult.value

		if (stream === null) {
			return failure(new ChannelNotLiveError(channelName))
		}

		return this.props.startRecording.execute({
			channelName,
			streamId: stream.id,
			title: stream.title,
			startedAt: stream.createdAt,
		})
	}
}
