import z from 'zod'

export const GetChannelVideosResponse = z.object({
	data: z.object({
		// `user` é null quando o login não existe — mesma semântica de
		// get-channel.ts.
		user: z
			.object({
				videos: z.object({
					edges: z.array(
						z.object({
							node: z.object({
								id: z.string(),
								// Twitch entrega ISO 8601; transform pra Date na borda —
								// mesmo idioma de get-channel.ts.
								createdAt: z.string().transform(s => new Date(s)),
								lengthSeconds: z.number(),
							}),
						})
					),
				}),
			})
			.nullable(),
	}),
})
