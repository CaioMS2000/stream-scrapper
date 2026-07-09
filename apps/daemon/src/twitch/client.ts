import type z from 'zod'
import { ChannelNotFoundError } from '../@errors'
import { failure, type Result, success } from '../result'
import { gqlRequest } from './http/gql'
import { CheckChannelResponse } from './http/schemas'

export class TwitchClient {
	async checkChannel(
		login: string
	): Promise<
		Result<
			ChannelNotFoundError,
			NonNullable<z.infer<typeof CheckChannelResponse>['data']['user']>
		>
	> {
		const { data } = await gqlRequest({
			operation: {
				query:
					'query($login: String!) { user(login: $login) { id displayName stream { id title } } }',
				variables: { login },
			},
			schema: CheckChannelResponse,
		})

		// null = canal não existe; caso contrário, `stream` diz se está ao vivo.
		if (data.user === null) {
			return failure(new ChannelNotFoundError(login))
		}

		return success(data.user)
	}
}
