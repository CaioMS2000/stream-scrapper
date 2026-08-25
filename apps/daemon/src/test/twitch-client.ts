import type {
	TwitchClient,
	TwitchClientImpl,
} from '../infrastructure/twitch/client'
import { success } from '../result'

export type GetChannelReturn = Awaited<
	ReturnType<TwitchClientImpl['getChannel']>
>

type GetChannelsReturn = Awaited<ReturnType<TwitchClientImpl['getChannels']>>

type GetChannelVideosReturn = Awaited<
	ReturnType<TwitchClientImpl['getChannelVideos']>
>

type GetVodPlaybackAccessTokenReturn = Awaited<
	ReturnType<TwitchClientImpl['getVodPlaybackAccessToken']>
>

export class FakeTwitchClient implements TwitchClient {
	constructor(
		private response: GetChannelReturn,
		private channelsResponse: GetChannelsReturn = success({
			users: [],
			notFoundUsers: [],
		}),
		private videosResponse: GetChannelVideosReturn = success([]),
		private playbackTokenResponse: GetVodPlaybackAccessTokenReturn = success({
			value: '',
			signature: '',
			forbidden: false,
		})
	) {}
	async getChannel(): Promise<GetChannelReturn> {
		return this.response
	}
	async getChannels(): Promise<GetChannelsReturn> {
		return this.channelsResponse
	}
	async getChannelVideos(): Promise<GetChannelVideosReturn> {
		return this.videosResponse
	}
	async getVodPlaybackAccessToken(): Promise<GetVodPlaybackAccessTokenReturn> {
		return this.playbackTokenResponse
	}
}
