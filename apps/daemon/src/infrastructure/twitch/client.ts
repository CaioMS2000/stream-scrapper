import type z from 'zod'
import {
	ChannelNotFoundError,
	VodPlaybackTokenNotFoundError,
} from '../../@errors'
import { failure, type Result, success } from '../../result'
import { gqlRequest } from './http/gql'
import {
	GetChannelResponse,
	GetChannelsResponse,
	GetChannelVideosResponse,
	GetVodPlaybackAccessTokenResponse,
	VodPlaybackTokenValue,
} from './http/schemas'

type ChannelFromResponse = NonNullable<
	z.infer<typeof GetChannelsResponse>['data']['users'][number]
>

type ChannelVideo = NonNullable<
	z.infer<typeof GetChannelVideosResponse>['data']['user']
>['videos']['edges'][number]['node']

export type VodPlaybackToken = {
	value: string
	signature: string
	forbidden: boolean
}

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
	// VODs arquivadas do canal (type ARCHIVE), mais recentes primeiro — não
	// expõe o streamId do broadcast, só id/createdAt/lengthSeconds da VOD.
	// Ver docs/design/002-download-de-vods.md, seção A.
	getChannelVideos(
		login: string,
		first?: number
	): Promise<Result<ChannelNotFoundError, ChannelVideo[]>>
	// Token de reprodução do VOD oficial — buscado fresco a cada uso, nunca
	// armazenado (mesma premissa da ADR 004, aplicada ao VOD). Ver
	// docs/design/002-download-de-vods.md, seção C.
	getVodPlaybackAccessToken(
		vodId: string
	): Promise<Result<VodPlaybackTokenNotFoundError, VodPlaybackToken>>
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

	async getChannelVideos(login: string, first = 20) {
		const { data } = await gqlRequest({
			operation: {
				query:
					'query($login: String!, $first: Int!) { user(login: $login) { videos(first: $first, type: ARCHIVE) { edges { node { id createdAt lengthSeconds } } } } }',
				variables: { login, first },
			},
			schema: GetChannelVideosResponse,
		})

		if (data.user === null) {
			return failure(new ChannelNotFoundError(login))
		}

		return success(data.user.videos.edges.map(edge => edge.node))
	}

	async getVodPlaybackAccessToken(vodId: string) {
		const { data } = await gqlRequest({
			operation: {
				query:
					'query($vodID: ID!) { videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }',
				variables: { vodID: vodId },
			},
			schema: GetVodPlaybackAccessTokenResponse,
		})

		if (data.videoPlaybackAccessToken === null) {
			return failure(new VodPlaybackTokenNotFoundError(vodId))
		}

		const { value, signature } = data.videoPlaybackAccessToken
		// `value` é uma string JSON aninhada (confirmado em
		// apps/daemon/spikes/FINDINGS.md, seção 2) — segundo parse necessário.
		const parsed = VodPlaybackTokenValue.parse(JSON.parse(value))

		return success({
			value,
			signature,
			forbidden: parsed.authorization.forbidden,
		})
	}
}
