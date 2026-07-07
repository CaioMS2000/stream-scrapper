import type { RecorderContract, RecordOpts } from '../recorder'
import type { Store, Streamer } from '../store'
import type { Twitch } from '../twitch'
import { TwitchDetection } from './detection.ts'
import type { DetectionSource, Monitor, MonitorState } from './types.ts'

// O gatilho proativo: pollia os monitorados, age só na BORDA offline→live (registra
// a stream + dispara o recorder pros auto_record). É onde a cadeia headless começa.
// Leve de propósito (spec §7): o peso mora no pool do recorder, não aqui.
export class StreamMonitor implements Monitor {
	private readonly store: Store
	private readonly twitch: Twitch
	private readonly recorder: RecorderContract
	private readonly detection: DetectionSource
	private readonly intervalMs: number
	private readonly recordDefaults: RecordOpts | undefined

	// último estado conhecido por login (age na transição, não a cada poll)
	private readonly state = new Map<string, MonitorState>()
	// stream_ids com gravação em andamento → idempotência (nunca dispara 2º recorder)
	private readonly recording = new Set<string>()

	private running = false
	private timer: ReturnType<typeof setTimeout> | null = null

	constructor(deps: {
		store: Store
		twitch: Twitch
		recorder: RecorderContract
		detection?: DetectionSource
		intervalMs?: number
		recordDefaults?: RecordOpts
	}) {
		this.store = deps.store
		this.twitch = deps.twitch
		this.recorder = deps.recorder
		this.detection = deps.detection ?? new TwitchDetection(deps.twitch)
		this.intervalMs = deps.intervalMs ?? 60_000
		this.recordDefaults = deps.recordDefaults
	}

	start(): void {
		if (this.running) return
		this.running = true
		// poll já, e reagenda com setTimeout recursivo (evita polls sobrepostos).
		void this.pollNow().finally(() => this.schedule())
	}

	stop(): void {
		this.running = false
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	getState(login: string): MonitorState {
		return this.state.get(login) ?? 'unknown'
	}

	// Uma passada. Robusta a falha por streamer (spec §8): um canal ruim não derruba
	// o loop nem impede os demais. Nunca lança.
	async pollNow(): Promise<void> {
		for (const s of this.store.listStreamers()) {
			try {
				await this.pollStreamer(s)
			} catch (err) {
				console.error(`[monitor] falha ao pollar ${s.login}:`, err)
			}
		}
	}

	private async pollStreamer(s: Streamer): Promise<void> {
		const meta = await this.detection.detect(s.login)
		const prev = this.state.get(s.login) ?? 'unknown'
		const now: MonitorState = meta ? 'live' : 'offline'

		// borda (offline|unknown) → live: colhe metadata, registra, talvez dispara.
		if (prev !== 'live' && meta) {
			this.store.upsertStream({
				stream_id: meta.streamId,
				streamer_login: s.login,
				started_at: meta.startedAt,
				title: meta.title,
				game: meta.game,
			})
			console.log(
				`[monitor] ${s.login} AO VIVO — stream ${meta.streamId} (${meta.title ?? '—'})`
			)
			if (s.auto_record === 1 && !this.recording.has(meta.streamId)) {
				this.recording.add(meta.streamId) // marca ANTES do await (idempotência)
				void this.dispatchRecord(s, meta.streamId).finally(() =>
					this.recording.delete(meta.streamId)
				)
			}
		}

		// live → offline: o recorder finaliza sozinho (ENDLIST); só atualiza o estado.
		if (prev === 'live' && now === 'offline') {
			console.log(`[monitor] ${s.login} encerrou`)
		}

		this.state.set(s.login, now)
	}

	// Resolve o manifesto live (via twitch) e dispara o recorder. Fire-and-forget:
	// erros são logados, NUNCA re-lançados (o loop tem que sobreviver, spec §8).
	private async dispatchRecord(s: Streamer, streamId: string): Promise<void> {
		try {
			const r = await this.twitch.resolveLiveManifest(s.login)
			if (!r.ok) {
				console.error(`[monitor] não resolveu a live de ${s.login}: ${r.error}`)
				return
			}
			await this.recorder.record(streamId, r.manifest, {
				quality: s.quality_pref,
				durationSeconds: this.recordDefaults?.durationSeconds,
				// re-auth do puller: re-resolve o manifesto live quando o token vence.
				refresh: () =>
					this.twitch
						.resolveLiveManifest(s.login)
						.then(x => (x.ok ? x.manifest : null)),
			})
		} catch (err) {
			console.error(`[monitor] gravação de ${s.login} falhou:`, err)
		}
	}

	private schedule(): void {
		if (!this.running) return
		this.timer = setTimeout(() => {
			void this.pollNow().finally(() => this.schedule())
		}, this.intervalMs)
	}
}
