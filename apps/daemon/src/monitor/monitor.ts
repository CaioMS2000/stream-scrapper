import { Emitter } from '../@shared/events'
import type { Optional } from '../@shared/types'
import type { Store } from '../store'
import type { TwitchClient } from '../twitch/client'
import type { MonitorEvent, MonitorListener } from './type'

export type ChannelMonitorProps = {
	intervalMs: number
	twitch: TwitchClient
	store: Store
	/**
	 * Emitter dedicado deste Monitor. Vem por injeção pra manter uniforme com
	 * as outras dependências (twitch, store) — decisão consciente aceitando o
	 * custo de cerimônia na composição/teste.
	 *
	 * ⚠️ **NUNCA compartilhe a mesma instância entre classes emissoras** —
	 * cada emissor (Monitor, Recorder, etc.) deve ter a sua própria. Se você
	 * sentir necessidade de compartilhar (ex: "quero um handler central que
	 * escute vários produtores sem depender de cada um"), isso é sinal pra
	 * promover pro Estágio 3 (EventBus central) descrito em
	 * `notes/events-evolution.md` — NÃO tentar contornar reusando Emitter.
	 */
	events: Emitter<MonitorEvent>
}

export type ChannelMonitorConstructorProps = Optional<
	ChannelMonitorProps,
	'intervalMs' | 'events'
>

function makeDefaultProps() {
	const DEFAULT_PROPS = {
		intervalMs: 30_000,
		events: new Emitter<MonitorEvent>('monitor'),
	} as const

	return DEFAULT_PROPS
}

export class ChannelMonitor {
	private readonly props: ChannelMonitorProps
	private timer: Timer | null = null

	constructor(props: ChannelMonitorConstructorProps) {
		this.props = { ...makeDefaultProps(), ...props }
	}

	on(listener: MonitorListener) {
		this.props.events.on(listener)
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
		const channels = await this.props.store.getAllChannels()
		if (channels.length === 0) return

		const usernames = channels.map(c => c.username)
		const result = await this.props.twitch.getChannels(usernames)
		const { users, notFoundUsers } = result.value

		// Map login → startedAt do próprio Twitch (`stream.createdAt`). Quem não
		// está no map é offline (ou não existe mais — notFoundUsers cai no mesmo
		// balde).
		const liveNow = new Map<string, Date>()
		for (const user of users) {
			if (user.stream !== null) {
				liveNow.set(user.login.toLowerCase(), user.stream.createdAt)
			}
		}

		// Compara estado armazenado vs atual, age só nas transições.
		for (const channel of channels) {
			const wasLive = channel.isLive
			const startedAt = liveNow.get(channel.username.toLowerCase())
			const isLive = startedAt !== undefined
			if (wasLive === isLive) continue

			await this.props.store.updateChannel({ id: channel.id, isLive })
			if (startedAt !== undefined) {
				await this.props.events.emit({
					type: 'live',
					username: channel.username,
					startedAt,
				})
			} else {
				await this.props.events.emit({
					type: 'offline',
					username: channel.username,
					at: new Date(),
				})
			}
		}

		if (notFoundUsers.length > 0) {
			console.warn('[monitor] canais não encontrados na twitch:', notFoundUsers)
		}
	}
}
