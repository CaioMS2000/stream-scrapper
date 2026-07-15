import type { StreamQuality } from './types'

export type ChannelModel = {
	id: string
	username: string
	displayName: string
	profileImageURL: string | null
	monitoredSince: Date
	autoRecord: boolean
	isLive: boolean
	qualityPref: StreamQuality
}
