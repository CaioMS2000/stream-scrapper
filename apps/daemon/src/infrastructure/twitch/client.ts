import type z from 'zod'
import { ChannelNotFoundError } from '../../@errors'
import { failure, type Result, success } from '../../result'
import { gqlRequest } from './http/gql'
import { GetChannelResponse, GetChannelsResponse } from './http/schemas'

type ChannelFromResponse = NonNullable<
	z.infer<typeof GetChannelsResponse>['data']['users'][number]
>

export interface TwitchClient {
	getChannel(
		login: string
	): Promise<
		Result<
			ChannelNotFoundError,
			NonNullable<z.infer<typeof GetChannelResponse>['data']['user']>
		>
	>
	getChannels(logins: string[]): Promise<
		Result<
			never,
			{
				users: ChannelFromResponse[]
				notFoundUsers: string[]
			}
		>
	>
}

export class TwitchClientImpl implements TwitchClient {
	async getChannel(login: string) {
		const { data } = await gqlRequest({
			operation: {
				query:
					'query($login: String!) { user(login: $login) { id displayName profileImageURL(width: 600) stream { id title createdAt } } }',
				variables: { login },
			},
			schema: GetChannelResponse,
		})

		// null = canal não existe; caso contrário, `stream` diz se está ao vivo.
		if (data.user === null) {
			return failure(new ChannelNotFoundError(login))
		}

		return success(data.user)
	}

	async getChannels(logins: string[]) {
		const { data } = await gqlRequest({
			operation: {
				query: `
					query($logins: [String!]!) {
						users(logins: $logins) {
							id
							login
							displayName
							profileImageURL(width: 300)
							stream { id title createdAt }
						}
					}
				`,
				variables: { logins },
			},
			schema: GetChannelsResponse,
		})

		// Twitch preserva posição: users[i] corresponde a logins[i], com null nas
		// posições dos inexistentes. Verificado empiricamente em 2026-07 contra
		// gql.twitch.tv/gql — se a semântica mudar, o teste de login inexistente
		// vai pegar.
		const { users, notFoundUsers } = data.users.reduce(
			(acc, u, i) => {
				if (u === null) acc.notFoundUsers.push(logins[i]!)
				else acc.users.push(u)
				return acc
			},
			{
				users: [] as ChannelFromResponse[],
				notFoundUsers: [] as string[],
			}
		)

		return success({ users, notFoundUsers })
	}
}
