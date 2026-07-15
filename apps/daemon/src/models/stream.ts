export type StreamModel = {
	id: string
	streamId: string
	channelName: string
	startedAt: Date
	title: string
	category: string | null
	durationSeconds: number | null
	vodId: string | null
}
