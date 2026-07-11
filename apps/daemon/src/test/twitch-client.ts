import { success } from '../result'
import type { TwitchClient, TwitchClientImpl } from '../twitch/client'

export type GetChannelReturn = Awaited<
	ReturnType<TwitchClientImpl['getChannel']>
>

type GetChannelsReturn = Awaited<ReturnType<TwitchClientImpl['getChannels']>>

export class FakeTwitchClient implements TwitchClient {
	constructor(private response: GetChannelReturn) {}
	async getChannel(): Promise<GetChannelReturn> {
		return this.response
	}
	async getChannels(): Promise<GetChannelsReturn> {
		// Não é exercitado por nenhum teste hoje; devolve vazio pra satisfazer a
		// interface. Se algum teste passar a exigir isso, evolui pra receber
		// resposta no construtor igual `getChannel`.
		return success({ users: [], notFoundUsers: [] })
	}
}
