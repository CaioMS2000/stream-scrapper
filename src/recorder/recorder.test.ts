import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '../store'
import type { Manifest } from '../twitch'
import { Recorder } from './recorder.ts'
import type { CaptureEngine } from './types.ts'

// Fake engine offline: capture escreve um .ts dummy; remux "muxa" copiando pro .mp4.
const fakeEngine: CaptureEngine = {
	async capture(_url, tsPath) {
		await Bun.write(tsPath, 'fake ts segments')
	},
	async remux(tsPath, mp4Path) {
		await Bun.write(mp4Path, await Bun.file(tsPath).text())
	},
}

// Manifest live canned (source 'authenticated', uma qualidade).
const manifest: Manifest = {
	source: 'authenticated',
	variants: [
		{
			name: 'chunked',
			bandwidth: 0,
			resolution: '',
			mediaPlaylistUrl: 'https://usher/live.m3u8',
		},
	],
	authContext: { clientId: 'x' },
	muted: false,
}

function withStore(fn: (store: SqliteStore, root: string) => Promise<void>) {
	return async () => {
		const root = mkdtempSync(join(tmpdir(), 'rec-'))
		const store = new SqliteStore(root)
		store.upsertStream({
			stream_id: '123',
			streamer_login: 'x',
			started_at: 100,
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
	'record: grava o recording.mp4 e arquiva no store (composição completa)',
	withStore(async (store, root) => {
		const rec = new Recorder({ store, engine: fakeEngine })
		const handle = await rec.record('123', manifest)

		// desfecho
		expect(handle.status).toBe('completed')
		expect(handle.quality).toBe('chunked')

		// arquivo remuxado no disco, na pasta reservada pelo store
		expect(existsSync(join(root, 'x', '123_100', 'recording.mp4'))).toBe(true)
		expect(existsSync(join(root, 'x', '123_100', 'meta.json'))).toBe(true)

		// linha recordings persistida como completed, finalizada
		const rows = store.listRecordings()
		expect(rows.length).toBe(1)
		expect(rows[0]?.status).toBe('completed')
		expect(rows[0]?.ended_at).not.toBeNull()
		expect((rows[0]?.bytes ?? 0) > 0).toBe(true)

		// nada mais ativo
		expect(rec.listActive().length).toBe(0)
	})
)

test(
	'record: captura falha → parcial finalizado, marcado failed, SEM rethrow',
	withStore(async (store, root) => {
		// engine cuja capture escreve um .ts parcial e ENTÃO lança; remux ainda roda.
		const flaky: CaptureEngine = {
			async capture(_url, tsPath) {
				await Bun.write(tsPath, 'parcial antes do crash')
				throw new Error('token expirou no meio')
			},
			remux: fakeEngine.remux,
		}
		const rec = new Recorder({ store, engine: flaky })

		// não re-lança: retorna o handle com status failed
		const handle = await rec.record('123', manifest)
		expect(handle.status).toBe('failed')

		// parcial preservado e finalizado
		expect(existsSync(join(root, 'x', '123_100', 'recording.mp4'))).toBe(true)

		const rows = store.listRecordings()
		expect(rows.length).toBe(1)
		expect(rows[0]?.status).toBe('failed')
	})
)

test(
	'record: stream fora do índice → lança (garante o vínculo)',
	withStore(async store => {
		const rec = new Recorder({ store, engine: fakeEngine })
		await expect(rec.record('inexistente', manifest)).rejects.toThrow(
			/não existe/
		)
	})
)
