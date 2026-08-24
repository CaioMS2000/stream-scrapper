export class ChannelRecordingInProgressError extends Error {
	constructor(channel: string) {
		super(`Cannot remove channel while recording is in progress: ${channel}`)
		this.name = 'ChannelRecordingInProgressError'
	}
}
