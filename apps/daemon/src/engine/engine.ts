import {
	ChannelAlreadyRegisteredError,
	type ChannelNotFoundError,
} from '../@errors'
import { failure, type Result, success } from '../result'
import type { Store } from '../store'
import type { TwitchClientImpl } from '../twitch/client'

export type EngineProps = {
	twitch: TwitchClientImpl
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
			{ username: string }
		>
	> {
		const result = await this.twitch.checkChannel(channel)

		if (result.isFailure()) {
			return failure(result.value)
		}

		const existingChannel = await this.store.findChannel(channel)

		if (existingChannel !== null) {
			return failure(ChannelAlreadyRegisteredError)
		}

		this.store.ensureChannelPath(channel)

		const newRecord = await this.store.addChannel(channel, {
			name: result.value.displayName,
		})

		return success({ username: newRecord.username })
	}
}
