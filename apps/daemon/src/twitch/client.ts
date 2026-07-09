import { gqlRequest } from './http/gql'
import { CheckChannelResponse } from './http/schemas'

export class TwitchClient {
	async checkChannel(login: string) {
		const { data } = await gqlRequest({
			operation: {
				query:
					'query($login: String!) { user(login: $login) { id displayName stream { id title } } }',
				variables: { login },
			},
			schema: CheckChannelResponse,
		})

		// null = canal não existe; caso contrário, `stream` diz se está ao vivo.
		return data.user
	}
}
