import type { ZodType } from 'zod'

const GQL_URL = 'https://gql.twitch.tv/gql'
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // web client público

export class GqlError extends Error {}

export class GqlHttpError extends GqlError {
	constructor(
		public readonly status: number,
		body: string
	) {
		super(`GQL HTTP ${status}: ${body.slice(0, 200)}`)
		this.name = 'GqlHttpError'
	}
}

type GqlOperation = {
	query: string
	variables?: Record<string, unknown>
}

type GqlRequest<T> = {
	operation: GqlOperation
	schema: ZodType<T>
}

export async function gqlRequest<T>({
	operation,
	schema,
}: GqlRequest<T>): Promise<T> {
	const res = await fetch(GQL_URL, {
		method: 'POST',
		headers: {
			'Client-Id': CLIENT_ID,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(operation),
	})

	// O GQL da Twitch responde erros de GraphQL com HTTP 200, mas rate limit
	// (429) e falhas do lado deles (5xx) vêm no status. Aqui distinguimos isso
	// de um schema quebrado — um throw barulhento é melhor que um null mudo.
	if (!res.ok) {
		throw new GqlHttpError(res.status, await res.text())
	}

	// O schema é responsável por modelar tanto o `data` esperado quanto o
	// `errors` de GraphQL; se a forma mudar, o parse estoura (é o que queremos).
	return schema.parse(await res.json())
}
