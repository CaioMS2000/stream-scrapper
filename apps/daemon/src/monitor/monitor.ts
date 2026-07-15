import type { ChannelRepository } from '@/repositories'
import type { EventBus } from '../@shared/events'
import type { Optional } from '../@shared/types'
import type { TwitchClient } from '../twitch/client'
import { ChannelLiveEvent, ChannelOfflineEvent } from './@events'

export type ChannelMonitorProps = {
	intervalMs: number
	twitch: TwitchClient
	channelRepository: ChannelRepository
	/**
	 * Bus central compartilhado por todo o daemon. Monitor publica eventos
	 * aqui; consumidores (Engine, futuros webhooks/métricas/audit) assinam
	 * as classes que interessam.
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
			console.error('[monitor] checkOnLiveChannels failed:', error)
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

		// Map login → snapshot do stream do próprio Twitch (`createdAt` + `title`).
		// Quem não está no map é offline (ou não existe mais — notFoundUsers cai
		// no mesmo balde).
		const liveNow = new Map<string, { startedAt: Date; title: string }>()
		for (const user of users) {
			if (user.stream !== null) {
				liveNow.set(user.login.toLowerCase(), {
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
				await this.props.bus.publish(
					new ChannelLiveEvent({
						username: channel.username,
						startedAt: liveInfo.startedAt,
						title: liveInfo.title,
					})
				)
			} else {
				await this.props.bus.publish(new ChannelOfflineEvent(channel.username))
			}
		}

		if (notFoundUsers.length > 0) {
			console.warn('[monitor] canais não encontrados na twitch:', notFoundUsers)
		}
	}
}
