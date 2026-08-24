export class ChannelNotRecordingError extends Error {
	constructor(channel: string) {
		super(`Channel is not currently recording: ${channel}`)
		this.name = 'ChannelNotRecordingError'
	}
}
