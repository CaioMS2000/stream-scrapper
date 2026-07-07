import z from 'zod'

export const CheckChannelResponse = z.object({
	data: z.object({
		user: z.object({
			id: z.string(),
			displayName: z.string(),
			stream: z
				.object({
					id: z.string(),
					title: z.string(),
				})
				.nullable(),
		}),
	}),
})
