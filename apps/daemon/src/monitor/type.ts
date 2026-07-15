import type { ChannelLiveEvent } from './@events'

export type MonitorListener = (event: ChannelLiveEvent) => void | Promise<void>
