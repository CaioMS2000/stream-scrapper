import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '../store'
import type { Manifest } from '../twitch'
import { DownloadManager } from './downloader.ts'
import type { DownloadStrategy } from './types.ts'

// Fake strategy: em vez de ffmpeg, escreve um dummy no outputPath. Offline.
const fakeStrategy: DownloadStrategy = {
	async download(_url, outputPath) {
		await Bun.write(outputPath, 'fake video bytes')
	},
}

const manifest: Manifest = {
	source: 'cdn-recovery',
	variants: [
		{
			name: 'chunked',
			bandwidth: 0,
			resolution: '',
			mediaPlaylistUrl: 'https://cdn/x.m3u8',
		},
	],
	authContext: { clientId: 'x' },
	muted: false,
}

function withStore(fn: (store: SqliteStore, root: string) => Promise<void>) {
	return async () => {
		const root = mkdtempSync(join(tmpdir(), 'dl-'))
		const store = new SqliteStore(root)
		store.upsertStream({
			stream_id: '123',
			streamer_login: 'x',
			started_at: 100,
			vod_id: '999',
		})
		try {
			await fn(store, root)
		} finally {
			store.close()
			rmSync(root, { recursive: true, force: true })
		}
	}
}

test(
	'download: baixa o vod.mp4 e arquiva no store (composição completa)',
	withStore(async (store, root) => {
		const dl = new DownloadManager({ store, strategy: fakeStrategy })
		const handle = await dl.download('123', manifest)

		// desfecho
		expect(handle.status).toBe('completed')
		expect(handle.source).toBe('cdn-recovery')
		expect(handle.storagePath).not.toBeNull()

		// arquivo no disco, na pasta reservada pelo store
		expect(existsSync(handle.storagePath as string)).toBe(true)
		expect(existsSync(join(root, 'x', '123_100', 'vod.mp4'))).toBe(true)
		expect(existsSync(join(root, 'x', '123_100', 'meta.json'))).toBe(true)

		// linha downloads persistida como completed
		const rows = store.listDownloads()
		expect(rows.length).toBe(1)
		expect(rows[0]?.status).toBe('completed')
		expect(rows[0]?.progress).toBe(1)
	})
)

test(
	'download: strategy falha → download marcado failed e erro re-lançado',
	withStore(async store => {
		const boom: DownloadStrategy = {
			async download() {
				throw new Error('ffmpeg morreu')
			},
		}
		const dl = new DownloadManager({ store, strategy: boom })

		await expect(dl.download('123', manifest)).rejects.toThrow('ffmpeg morreu')

		const rows = store.listDownloads()
		expect(rows.length).toBe(1)
		expect(rows[0]?.status).toBe('failed')
	})
)

test(
	'download: stream fora do índice → lança (garante o vínculo)',
	withStore(async store => {
		const dl = new DownloadManager({ store, strategy: fakeStrategy })
		await expect(dl.download('inexistente', manifest)).rejects.toThrow(
			/não existe/
		)
	})
)
