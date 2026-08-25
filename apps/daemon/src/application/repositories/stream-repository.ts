import type { StreamModel } from '@/application/models'
import type { VodLookupStatus } from '@/application/models/types'

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

export type UpdateVodLookupParams = {
	streamId: string
	vodId: string | null
	vodLookupStatus: VodLookupStatus
}

export interface StreamRepository {
	createStream(params: CreateStreamParams): Promise<StreamModel>
	findOrCreateStream(params: CreateStreamParams): Promise<StreamModel>
	getStream(params: GetStreamParams): Promise<StreamModel>
	listStreamsByChannel(channelName: string): Promise<StreamModel[]>
	listStreamsByVodLookupStatus(status: VodLookupStatus): Promise<StreamModel[]>
	updateVodLookup(params: UpdateVodLookupParams): Promise<StreamModel>
}
