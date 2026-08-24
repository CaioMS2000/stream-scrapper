import type { ChannelRepository } from '@/application/repositories'
import type { TwitchRecorder } from '@/infrastructure/recorder'
import { type Result, success } from '@/result'

export type ChannelSummary = {
	username: string
	displayName: string
	isLive: boolean
	isRecording: boolean
	autoRecord: boolean
}

type UseCaseProps = {
	channelRepository: ChannelRepository
	recorder: TwitchRecorder
}

type UseCaseResponse = Result<never, ChannelSummary[]>

export class ListChannelsUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute(): Promise<UseCaseResponse> {
		const channels = await this.props.channelRepository.getAllChannels()

		const summaries = channels
			.map(channel => ({
				username: channel.username,
				displayName: channel.displayName,
				isLive: channel.isLive,
				isRecording: this.props.recorder.isRecording(channel.username),
				autoRecord: channel.autoRecord,
			}))
			.sort((a, b) => a.username.localeCompare(b.username))

		return success(summaries)
	}
}
