import { ChannelAlreadyRegisteredError, ChannelNotFoundError } from '../@errors'
import type { MediaStorage } from '../media-storage'
import type { ChannelLiveEvent, ChannelOfflineEvent } from '../monitor/@events'
import type { TwitchRecorder } from '../recorder'
import type { ChannelRepository, StreamRepository } from '../repositories'
import { failure, type Result, success } from '../result'
import type { TwitchClient } from '../twitch/client'

export type EngineProps = {
	twitch: TwitchClient
	channelRepository: ChannelRepository
	streamRepository: StreamRepository
	storage: MediaStorage
	recorder: TwitchRecorder
}

export class Engine {
	constructor(private readonly props: EngineProps) {}

	get twitch() {
		return this.props.twitch
	}

	async addChannel(
		channel: string
	): Promise<
		Result<
			ChannelNotFoundError | ChannelAlreadyRegisteredError,
			{ username: string; recording: boolean }
		>
	> {
		const result = await this.props.twitch.getChannel(channel)

		if (result.isFailure()) {
			return failure(result.value)
		}

		const existingChannel =
			await this.props.channelRepository.findChannel(channel)

		if (existingChannel !== null) {
			return failure(new ChannelAlreadyRegisteredError(channel))
		}

		this.props.storage.ensureChannelPath(channel)

		const newRecord = await this.props.channelRepository.addChannel(channel, {
			name: result.value.displayName,
			profileImageURL: result.value.profileImageURL,
		})

		return success({
			username: newRecord.username,
			recording: newRecord.autoRecord,
		})
	}

	async enableAutoRecording(
		channel: string
	): Promise<Result<ChannelNotFoundError, void>> {
		const existingChannel =
			await this.props.channelRepository.findChannel(channel)

		if (existingChannel === null) {
			return failure(new ChannelNotFoundError(channel))
		}

		return success(undefined)
	}

	// Handler do evento 'live' vindo do Monitor. Orquestra os dois invariantes
	// (persistir stream + disparar recorder) em chamadas síncronas — não
	// delega pra event handler pra evitar silêncio em falha (ver
	// notes/speculation-early-recorder-invariants-vs-reactions.md).
	async onStreamStarted(event: ChannelLiveEvent): Promise<void> {
		try {
			// Nota: hoje o evento só carrega username + startedAt. Pra usar
			// title/category/streamId de verdade, MonitorEvent precisa ser
			// enriquecido — por enquanto persistimos com placeholders.
			const streamId = `stub-${event.username}-${event.startedAt.getTime()}`
			await this.props.streamRepository.createStream({
				streamId,
				channelName: event.username,
				startedAt: event.startedAt,
				title: 'stub-title',
			})

			await this.props.recorder.recordTwitchStream({
				channelName: event.username,
				streamId,
				startedAt: event.startedAt,
			})
		} catch (error) {
			console.error(
				`[engine] onStreamStarted failed for ${event.username}:`,
				error
			)
		}
	}

	// Handler do evento 'offline'. Ordena o Recorder a parar; futuramente
	// também atualizará endedAt no stream row.
	async onStreamEnded(event: ChannelOfflineEvent): Promise<void> {
		try {
			await this.props.recorder.stopStream(event.username)
		} catch (error) {
			console.error(
				`[engine] onStreamEnded failed for ${event.username}:`,
				error
			)
		}
	}
}
