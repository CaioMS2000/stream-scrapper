import type { Store } from '../store'
import { type Manifest, TwitchClient } from '../twitch'
import { FfmpegLiveEngine } from './engine.ts'
import type {
	CaptureEngine,
	Recorder as RecorderContract,
	RecordingHandle,
	RecordOpts,
} from './types.ts'

// Espelho ao-vivo do downloader: recebe um Manifest live JÁ resolvido (fica "burro",
// não injeta twitch — quem resolve é o composition root/monitor) e grava uma cópia
// própria. Injeta store + engine; zero container. A diferença real vs downloader:
// grava .ts e remuxa no fim, e falha NÃO re-lança (parcial finalizado é o desfecho).
export class Recorder implements RecorderContract {
	private readonly store: Store
	private readonly engine: CaptureEngine
	private readonly active = new Map<string, RecordingHandle>()

	constructor(deps: { store: Store; engine?: CaptureEngine }) {
		this.store = deps.store
		this.engine = deps.engine ?? new FfmpegLiveEngine()
	}

	async record(
		streamId: string,
		manifest: Manifest,
		opts?: RecordOpts
	): Promise<RecordingHandle> {
		const variant = TwitchClient.selectQuality(
			manifest.variants,
			opts?.quality ?? 'best'
		)
		// reserveStoragePath lança se a stream não está no índice — garante o vínculo.
		const mp4 = this.store.reserveStoragePath(streamId, 'recording')
		// grava no .ts irmão (mesma pasta); o .mp4 é o produto do remux final.
		const tsPath = mp4.replace(/\.mp4$/, '.ts')

		const rec = this.store.createRecording(streamId, variant.name)
		const handle: RecordingHandle = {
			id: rec.id,
			streamId,
			status: 'recording',
			startedAt: rec.started_at,
			quality: variant.name,
			storagePath: mp4,
		}
		this.active.set(rec.id, handle)

		// Deriva o refresh de URL a partir do refresh de Manifest (re-auth do puller):
		// re-resolve → re-seleciona a MESMA qualidade → nova URL de media playlist.
		const quality = opts?.quality ?? 'best'
		const urlRefresh = opts?.refresh
			? async (): Promise<string | null> => {
					const m = await opts.refresh?.()
					return m
						? TwitchClient.selectQuality(m.variants, quality).mediaPlaylistUrl
						: null
				}
			: undefined

		let captureFailed = false
		try {
			await this.engine.capture(variant.mediaPlaylistUrl, tsPath, {
				durationSeconds: opts?.durationSeconds,
				refresh: urlRefresh,
			})
		} catch {
			// Não re-lança: parcial-é-melhor-que-nada. Finaliza o .ts antes de marcar.
			captureFailed = true
		}

		// Finalize sempre (§7): remuxa o .ts (parcial OU completo) pra .mp4 tocável.
		let bytes: number | null = null
		try {
			await this.engine.remux(tsPath, mp4)
			bytes = Bun.file(mp4).size
		} catch {
			// remux do parcial falhou (ex.: .ts vazio); segue com o desfecho que der.
		}

		const status = captureFailed ? 'failed' : 'completed'
		this.store.updateRecording(rec.id, {
			status,
			ended_at: Math.floor(Date.now() / 1000),
			storage_path: mp4,
			bytes,
		})
		await this.store.writeMeta(streamId) // arquiva o meta.json auto-descritivo

		this.active.delete(rec.id)
		handle.status = status
		return handle
	}

	listActive(): RecordingHandle[] {
		return [...this.active.values()]
	}
}
