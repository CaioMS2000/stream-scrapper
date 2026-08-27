import type {
	ChannelRepository,
	StreamRepository,
} from '@/application/repositories'
import type { EventBus } from '../../@shared/events'
import { logger } from '../../@shared/logger'
import type { Optional } from '../../@shared/types'
import type { MediaStorage, StreamMetaStorage } from '../media-storage'
import type { TwitchClient } from '../twitch/client'
import { ChannelLiveEvent, ChannelOfflineEvent } from './@events'

export type ChannelMonitorProps = {
	intervalMs: number
	twitch: TwitchClient
	channelRepository: ChannelRepository
	streamRepository: StreamRepository
	storage: MediaStorage
	streamMetaStorage: StreamMetaStorage
	/**
	 * Bus central compartilhado por todo o daemon. Monitor publica eventos
	 * aqui; consumidores (use cases de start/stop recording, futuros
	 * webhooks/métricas/audit) assinam as classes que interessam.
	 *
	 * Diferente do padrão Emitter anterior — aqui **a mesma instância é
	 * intencionalmente compartilhada** entre todos os produtores/consumidores
	 * do daemon. Só uma `new EventBus()` no `main.ts`.
	 */
	bus: EventBus
}

export type ChannelMonitorConstructorProps = Optional<
	ChannelMonitorProps,
	'intervalMs'
>

function makeDefaultProps() {
	return {
		intervalMs: 30_000,
	}
}

export class ChannelMonitor {
	private readonly props: ChannelMonitorProps
	private timer: Timer | null = null

	constructor(props: ChannelMonitorConstructorProps) {
		this.props = { ...makeDefaultProps(), ...props }
	}

	async startMonitoring() {
		try {
			await this.checkOnLiveChannels()
		} catch (error) {
			logger.error('[monitor] checkOnLiveChannels failed:', error)
		}
		// setTimeout que se reagenda: garante zero overlap se checkOnLiveChannels() atrasar.
		this.timer = setTimeout(() => this.startMonitoring(), this.props.intervalMs)
	}

	stop() {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	private async checkOnLiveChannels() {
		const channels = await this.props.channelRepository.getAllChannels()
		if (channels.length === 0) return

		const usernames = channels.map(c => c.username)
		const result = await this.props.twitch.getChannels(usernames)
		const { users, notFoundUsers } = result.value

		// Map login → snapshot do stream do próprio Twitch (`id` + `createdAt` +
		// `title`). Quem não está no map é offline (ou não existe mais —
		// notFoundUsers cai no mesmo balde).
		const liveNow = new Map<
			string,
			{ id: string; startedAt: Date; title: string }
		>()
		for (const user of users) {
			if (user.stream !== null) {
				liveNow.set(user.login.toLowerCase(), {
					id: user.stream.id,
					startedAt: user.stream.createdAt,
					title: user.stream.title,
				})
			}
		}

		// Compara estado armazenado vs atual, age só nas transições.
		for (const channel of channels) {
			const wasLive = channel.isLive
			const liveInfo = liveNow.get(channel.username.toLowerCase())
			const isLive = liveInfo !== undefined
			if (wasLive === isLive) continue

			await this.props.channelRepository.updateChannel({
				id: channel.id,
				isLive,
			})
			if (liveInfo !== undefined) {
				// Invariante, não reação: registra a stream ANTES de publicar o
				// evento. Independente de autoRecord — todo canal que fica ao vivo
				// deixa rastro em `stream`, gravando ou não. Se isso fosse um
				// bus.subscribe, um erro seria engolido e a live sumiria sem deixar
				// vestígio (ver notes/speculation-early-recorder-invariants-vs-reactions.md).
				await this.props.streamRepository.findOrCreateStream({
					channelName: channel.username,
					streamId: liveInfo.id,
					startedAt: liveInfo.startedAt,
					title: liveInfo.title,
				})
				// Mesmo raciocínio: todo `stream` ganha um meta.json mínimo no
				// disco, independente de gravar. `StartRecordingUseCase` sobrescreve
				// com o formato completo quando (e se) a gravação de fato começar —
				// createStreamPath é determinístico, mesmo path sempre.
				const { fullPath } = this.props.storage.createStreamPath({
					channelName: channel.username,
					streamId: liveInfo.id,
					title: liveInfo.title,
					startedAt: liveInfo.startedAt,
				})
				this.props.streamMetaStorage.writeStreamMeta({
					storagePath: fullPath,
					metaFile: this.props.streamMetaStorage.toMetaFile({
						streamId: liveInfo.id,
						channelName: channel.username,
						title: liveInfo.title,
						startedAt: liveInfo.startedAt,
						endedAt: undefined,
						bytes: undefined,
						quality: undefined,
						status: undefined,
					}),
				})
				await this.props.bus.publish(
					new ChannelLiveEvent({
						username: channel.username,
						streamId: liveInfo.id,
						startedAt: liveInfo.startedAt,
						title: liveInfo.title,
					})
				)
			} else {
				await this.props.bus.publish(new ChannelOfflineEvent(channel.username))
			}
		}

		if (notFoundUsers.length > 0) {
			logger.warn('[monitor] canais não encontrados na twitch:', notFoundUsers)
		}
	}
}
