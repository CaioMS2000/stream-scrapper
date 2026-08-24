import {
	ChannelNotFoundError,
	ChannelNotRecordingError,
	type StreamStopFailedError,
} from '@/@errors'
import type { ChannelRepository } from '@/application/repositories'
import type { TwitchRecorder } from '@/infrastructure/recorder'
import { failure, type Result } from '@/result'
import type { StopRecordingUseCase } from './stop-recording'

type UseCaseProps = {
	channelRepository: ChannelRepository
	recorder: TwitchRecorder
	stopRecording: StopRecordingUseCase
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<
	ChannelNotFoundError | ChannelNotRecordingError | StreamStopFailedError,
	void
>

export class ForceStopUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const existingChannel =
			await this.props.channelRepository.findChannel(channelName)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channelName))
		}

		if (!this.props.recorder.isRecording(channelName)) {
			return failure(new ChannelNotRecordingError(channelName))
		}

		return this.props.stopRecording.execute({ channelName })
	}
}
