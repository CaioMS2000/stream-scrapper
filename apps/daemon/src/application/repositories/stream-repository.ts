import type { StreamModel } from '@/application/models'

export type CreateStreamParams = {
	streamId: string
	channelName: string
	startedAt: Date
	title: string
	category?: string
}

export type GetStreamParams =
	| {
			streamId: string
	  }
	| {
			id: string
	  }

export interface StreamRepository {
	createStream(params: CreateStreamParams): Promise<StreamModel>
	getStream(params: GetStreamParams): Promise<StreamModel>
}
