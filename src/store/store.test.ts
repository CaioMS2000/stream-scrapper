import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from './store.ts'

// A tese central do store (Modulo_Store §4): disco é a verdade, banco é índice.
// Prova: escrever → APAGAR o archive.db → reindexFromDisk reconstrói o acervo.
test('disco é a verdade: reindexFromDisk reconstrói o acervo após perder o banco', async () => {
	const root = mkdtempSync(join(tmpdir(), 'store-'))
	try {
		// 1) escreve: streamer + stream + arquivo de vídeo + meta.json
		let store = new SqliteStore(root)
		store.addStreamer({ login: 'teststreamer', display_name: 'Test' })
		store.upsertStream({
			stream_id: '123',
			streamer_login: 'teststreamer',
			started_at: 1781869331,
			title: 'hello',
			game: 'Just Chatting',
		})
		const recPath = store.reserveStoragePath('123', 'recording')
		await Bun.write(recPath, 'dummy bytes')
		await store.writeMeta('123')

		const before = store.getStream('123')
		expect(before).not.toBeNull()
		store.close()

		// 2) apaga o índice (banco + sidecars do WAL); o disco fica intacto
		const dbPath = join(root, 'archive.db')
		rmSync(dbPath)
		rmSync(`${dbPath}-wal`, { force: true })
		rmSync(`${dbPath}-shm`, { force: true })

		// 3) reabre: índice zerado, mas o meta.json e o vídeo ainda estão no disco
		store = new SqliteStore(root)
		expect(store.getStream('123')).toBeNull()
		expect(existsSync(recPath)).toBe(true)

		// 4) reindexa a partir do disco → o acervo volta idêntico
		await store.reindexFromDisk()
		expect(store.getStream('123')).toEqual(before)
		store.close()
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
})
