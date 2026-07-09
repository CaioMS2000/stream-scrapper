import type { TwitchClient, TwitchClientImpl } from '../twitch/client'

export type CheckChannelReturn = Awaited<
	ReturnType<TwitchClientImpl['checkChannel']>
>

export class FakeTwitchClient implements TwitchClient {
	constructor(private response: CheckChannelReturn) {}
	async checkChannel(): Promise<CheckChannelReturn> {
		return this.response
	}
}
