import { ChannelAlreadyRegisteredError, ChannelNotFoundError } from '../@errors'
import { failure, type Result, success } from '../result'
import type { Store } from '../store'
import type { TwitchClient } from '../twitch/client'

export type EngineProps = {
	twitch: TwitchClient
	store: Store
}

export class Engine {
	constructor(private props: EngineProps) {}

	get twitch() {
		return this.props.twitch
	}

	get store() {
		return this.props.store
	}

	async addChannel(
		channel: string
	): Promise<
		Result<
			ChannelNotFoundError | ChannelAlreadyRegisteredError,
			{ username: string; recording: boolean }
		>
	> {
		const result = await this.twitch.getChannel(channel)

		if (result.isFailure()) {
			return failure(result.value)
		}

		const existingChannel = await this.store.findChannel(channel)

		if (existingChannel !== null) {
			return failure(new ChannelAlreadyRegisteredError(channel))
		}

		this.store.ensureChannelPath(channel)

		const newRecord = await this.store.addChannel(channel, {
			name: result.value.displayName,
			profileImageURL: result.value.profileImageURL,
		})

		return success({
			username: newRecord.username,
			recording: newRecord.autoRecord,
		})
	}

	async enableAutoRecording(
		channel: string
	): Promise<Result<ChannelNotFoundError, void>> {
		const existingChannel = await this.store.findChannel(channel)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channel))
		}

		return success(undefined)
	}
}
