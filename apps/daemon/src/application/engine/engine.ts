import type { MediaStorage } from '../../infrastructure/media-storage'
import type {
	ChannelLiveEvent,
	ChannelOfflineEvent,
} from '../../infrastructure/monitor/@events'
import type { TwitchRecorder } from '../../infrastructure/recorder'
import type { StreamRepository } from '../repositories'

export type EngineProps = {
	streamRepository: StreamRepository
	storage: MediaStorage
	recorder: TwitchRecorder
}

export class Engine {
	constructor(private readonly props: EngineProps) {}

	// Handler do evento 'live' vindo do Monitor. Orquestra os dois invariantes
	// (persistir stream + disparar recorder) em chamadas síncronas — não
	// delega pra event handler pra evitar silêncio em falha (ver
	// notes/speculation-early-recorder-invariants-vs-reactions.md).
	async onStreamStarted(event: ChannelLiveEvent): Promise<void> {
		try {
			// Nota: streamId ainda é placeholder — Monitor não carrega o
			// `stream.id` do Twitch no evento (só username/title/startedAt).
			// Category/streamId reais entram quando MonitorEvent for enriquecido.
			const streamId = `stub-${event.username}-${event.startedAt.getTime()}`

			await this.props.streamRepository.createStream({
				streamId,
				channelName: event.username,
				startedAt: event.startedAt,
				title: event.title,
			})
			const { fullPath } = this.props.storage.createStreamPath({
				channelName: event.username,
				streamId,
				title: event.title,
				startedAt: event.startedAt,
			})
			await this.props.recorder.recordTwitchStream({
				channelName: event.username,
				streamId,
				startedAt: event.startedAt,
				title: event.title,
				filePath: fullPath,
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
