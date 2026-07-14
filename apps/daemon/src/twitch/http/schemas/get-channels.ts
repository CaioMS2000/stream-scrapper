import z from 'zod'

export const GetChannelsResponse = z.object({
	data: z.object({
		users: z.array(
			z
				.object({
					id: z.string(),
					login: z.string(),
					displayName: z.string(),
					profileImageURL: z.string(),
					stream: z
						.object({
							id: z.string(),
							title: z.string(),
							// Twitch entrega ISO 8601 (ex: "2026-07-14T02:04:03Z");
							// transform pra Date na borda pra consumidores usarem direto.
							createdAt: z.string().transform(s => new Date(s)),
						})
						.nullable(),
				})
				.nullable()
		),
	}),
})
