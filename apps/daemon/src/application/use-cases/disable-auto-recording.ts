import { ChannelNotFoundError } from '@/@errors'
import type { ChannelRepository } from '@/application/repositories'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	channelRepository: ChannelRepository
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<ChannelNotFoundError, void>

export class DisableAutoRecordingUseCase {
	constructor(private readonly props: UseCaseProps) {}

	private get channelRepository() {
		return this.props.channelRepository
	}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const existingChannel =
			await this.channelRepository.findChannel(channelName)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channelName))
		}

		void (await this.channelRepository.updateChannel({
			id: existingChannel.id,
			autoRecord: false,
		}))

		return success(undefined)
	}
}
