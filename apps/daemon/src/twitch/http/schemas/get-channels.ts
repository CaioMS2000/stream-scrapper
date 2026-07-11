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
					stream: z.object({ id: z.string(), title: z.string() }).nullable(),
				})
				.nullable()
		),
	}),
})
