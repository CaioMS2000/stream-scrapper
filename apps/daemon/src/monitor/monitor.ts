import type { Optional } from '../@shared/types'
import type { TwitchClient } from '../twitch/client'
import type { CurrentChannelState } from './type'

export type ChannelMonitorProps = {
	intervalMs: number
	twitch: TwitchClient
}

export type ChannelMonitorConstructorProps = Optional<
	ChannelMonitorProps,
	'intervalMs'
>

const DEFAULT_PROPS = {
	intervalMs: 30_000,
} as const

export class ChannelMonitor {
	private readonly props: ChannelMonitorProps
	// private timer: NodeJS.Timeout | null = null
	private timer: Timer | null = null

	constructor(props: ChannelMonitorConstructorProps) {
		this.props = { ...DEFAULT_PROPS, ...props }
	}

	async checkOnLiveChannels(channels: CurrentChannelState[]) {
		const channelsNames = channels.map(c => c.username)

		if (channelsNames.length === 0) {
			return
		}

		const channelsResult = await this.props.twitch.getChannels(channelsNames)
	}
}
