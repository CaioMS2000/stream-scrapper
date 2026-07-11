import z from 'zod'

export const GetChannelResponse = z.object({
	data: z.object({
		// `user` é null quando o login não existe (canal inexistente),
		// diferente de existir e estar offline (`stream` null).
		user: z
			.object({
				id: z.string(),
				displayName: z.string(),
				profileImageURL: z.string(),
				stream: z
					.object({
						id: z.string(),
						title: z.string(),
					})
					.nullable(),
			})
			.nullable(),
	}),
})
