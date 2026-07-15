import type { MediaStorage } from '@/media-storage'
import type { TwitchClient } from '@/twitch/client'
import type { TwitchRecorder } from './types'

export type StreamRecorderProps = {
	twitch: TwitchClient
	storage: MediaStorage
}

export class StreamRecorder implements TwitchRecorder {
	constructor(private readonly props: StreamRecorderProps) {}

	// Stub — implementação real spawnará streamlink e supervisionará o
	// child process. Ver notes/recording-twitch-streams.md.
	recordTwitchStream: TwitchRecorder['recordTwitchStream'] = async ({
		channelName,
		streamId,
		startedAt,
	}) => {
		console.log(
			`[recorder] recordTwitchStream STUB called for ${channelName} (streamId=${streamId}, startedAt=${startedAt.toISOString()})`
		)
		return {
			id: 'stub-recording-id',
			streamId,
			startedAt: startedAt.getTime(),
			quality: 'stub-quality',
			storagePath: 'stub-path',
		}
	}

	// Stub — implementação real vai matar o child process de streamlink e
	// atualizar o row de recording com endedAt/status.
	stopStream: TwitchRecorder['stopStream'] = async username => {
		console.log(`[recorder] stopStream STUB called for ${username}`)
	}
}
