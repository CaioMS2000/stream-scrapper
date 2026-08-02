import {
	ChannelAlreadyRegisteredError,
	type ChannelNotFoundError,
} from '@/@errors'
import type { ChannelRepository } from '@/application/repositories'
import type { MediaStorage } from '@/infrastructure/media-storage'
import type { TwitchClient } from '@/infrastructure/twitch/client'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	twitch: TwitchClient
	channelRepository: ChannelRepository
	storage: MediaStorage
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<
	ChannelNotFoundError | ChannelAlreadyRegisteredError,
	{ username: string; recording: boolean }
>

export class AddChannelUseCase {
	constructor(private readonly props: UseCaseProps) {}

	private get twitch() {
		return this.props.twitch
	}

	private get channelRepository() {
		return this.props.channelRepository
	}

	private get storage() {
		return this.props.storage
	}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const result = await this.twitch.getChannel(channelName)

		if (result.isFailure()) {
			return failure(result.value)
		}

		const existingChannel =
			await this.channelRepository.findChannel(channelName)

		if (existingChannel !== null) {
			return failure(new ChannelAlreadyRegisteredError(channelName))
		}

		this.storage.ensureChannelPath(channelName)

		const newRecord = await this.channelRepository.addChannel(channelName, {
			name: result.value.displayName,
			profileImageURL: result.value.profileImageURL,
		})

		return success({
			username: newRecord.username,
			recording: newRecord.autoRecord,
		})
	}
}
