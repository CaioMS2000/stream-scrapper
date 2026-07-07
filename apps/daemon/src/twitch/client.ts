import { CheckChannelResponse } from './http/schemas'
export class TwitchClient {
	private readonly clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // web client público

	async checkChannel(user: string) {
		const res = await fetch('https://gql.twitch.tv/gql', {
			method: 'POST',
			headers: {
				'Client-Id': this.clientId,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query:
					'query($login: String!) { user(login: $login) { id displayName stream { id title } } }',
				variables: { login: user },
			}),
		})
		const parseResult = CheckChannelResponse.safeParse(await res.json())

		if (parseResult.success === false) {
			return null
		}

		return parseResult.data.data
	}
}
