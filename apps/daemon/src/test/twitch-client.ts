import type {
	TwitchClient,
	TwitchClientImpl,
} from '../infrastructure/twitch/client'
import { success } from '../result'

export type GetChannelReturn = Awaited<
	ReturnType<TwitchClientImpl['getChannel']>
>

type GetChannelsReturn = Awaited<ReturnType<TwitchClientImpl['getChannels']>>

export class FakeTwitchClient implements TwitchClient {
	constructor(
		private response: GetChannelReturn,
		private channelsResponse: GetChannelsReturn = success({
			users: [],
			notFoundUsers: [],
		})
	) {}
	async getChannel(): Promise<GetChannelReturn> {
		return this.response
	}
	async getChannels(): Promise<GetChannelsReturn> {
		return this.channelsResponse
	}
}
