import {
	ChannelAlreadyRegistreError,
	type ChannelNotFoundError,
} from '../@errors'
import { type FailureOf, failure, type Result, success } from '../result'
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
	): Promise<Result<ChannelNotFoundError | ChannelAlreadyRegistreError, any>> {
		const result = await this.twitch.checkChannel(channel)

		if (result.isFailure()) {
			return failure(result.value)
		}

		const existingChannel = await this.store.findChannel(channel)

		if (existingChannel === null) {
			return failure(ChannelAlreadyRegistreError)
		}

		return success(null)
	}
}
