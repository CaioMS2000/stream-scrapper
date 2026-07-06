import type { Store } from '../store'
import { type Manifest, TwitchClient } from '../twitch'
import { FfmpegStrategy } from './strategy.ts'
import type {
	Downloader,
	DownloadHandle,
	DownloadOpts,
	DownloadStrategy,
} from './types.ts'

// Espelho reativo do recorder: recebe um VOD que JÁ existe (manifesto resolvido)
// e o baixa, produzindo um vod.mp4 arquivado pelo store. Injeta store + strategy;
// twitch NÃO é injetado (o manifesto entra pronto). Zero container.
export class DownloadManager implements Downloader {
	private readonly store: Store
	private readonly strategy: DownloadStrategy

	constructor(deps: { store: Store; strategy?: DownloadStrategy }) {
		this.store = deps.store
		this.strategy = deps.strategy ?? new FfmpegStrategy()
	}

	async download(
		streamId: string,
		manifest: Manifest,
		opts?: DownloadOpts
	): Promise<DownloadHandle> {
		const variant = TwitchClient.selectQuality(
			manifest.variants,
			opts?.quality ?? 'best'
		)
		// reserveStoragePath lança se a stream não está no índice — garante o vínculo.
		const out = this.store.reserveStoragePath(streamId, 'vod')
		const dl = this.store.createDownload(streamId, manifest.source)
		this.store.updateDownload(dl.id, { status: 'downloading' })

		try {
			await this.strategy.download(variant.mediaPlaylistUrl, out, {
				durationSeconds: opts?.durationSeconds,
			})
		} catch (err) {
			this.store.updateDownload(dl.id, { status: 'failed' })
			throw err
		}

		this.store.updateDownload(dl.id, {
			status: 'completed',
			progress: 1,
			storage_path: out,
		})
		await this.store.writeMeta(streamId) // arquiva o meta.json auto-descritivo

		return {
			id: dl.id,
			streamId,
			source: manifest.source,
			status: 'completed',
			progress: 1,
			storagePath: out,
		}
	}
}
