import z from 'zod'

export const GetVodPlaybackAccessTokenResponse = z.object({
	data: z.object({
		// null quando o vodId não existe de verdade (ex: deletado).
		videoPlaybackAccessToken: z
			.object({
				value: z.string(),
				signature: z.string(),
			})
			.nullable(),
	}),
})

// `value` acima é, ele mesmo, uma string JSON aninhada — confirmado em
// apps/daemon/spikes/FINDINGS.md (seção 2). Precisa de um segundo parse.
// Só `authorization.forbidden` importa pro escopo atual (detectar VOD
// sub-only sem precisar tentar baixar antes).
export const VodPlaybackTokenValue = z.object({
	authorization: z.object({
		forbidden: z.boolean(),
	}),
})
