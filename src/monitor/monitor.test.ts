import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecorderContract, RecordingHandle } from '../recorder'
import { SqliteStore } from '../store'
import type { Manifest, ResolveResult, Twitch } from '../twitch'
import { StreamMonitor } from './monitor.ts'
import type { DetectionSource, LiveMetadata } from './types.ts'

// deixa os microtasks do dispatch fire-and-forget drenarem antes do assert.
const flush = () => new Promise(r => setTimeout(r, 0))

const manifest: Manifest = {
	source: 'authenticated',
	variants: [
		{
			name: 'chunked',
			bandwidth: 0,
			resolution: '',
			mediaPlaylistUrl: 'https://x',
		},
	],
	authContext: { clientId: 'x' },
	muted: false,
}

// fake Twitch: só resolveLiveManifest importa (a detecção é injetada à parte).
function fakeTwitch(): Twitch {
	return {
		resolveVodManifest: async (): Promise<ResolveResult> => ({
			ok: false,
			error: 'not-found',
		}),
		recoverVodManifest: async (): Promise<ResolveResult> => ({
			ok: false,
			error: 'not-on-cdn',
		}),
		resolveLiveManifest: async (): Promise<ResolveResult> => ({
			ok: true,
			manifest,
		}),
		getLiveMetadata: async () => null,
	}
}

function metaFor(streamId: string): LiveMetadata {
	return { userId: 'u1', streamId, startedAt: 1000, title: 't', game: 'g' }
}

// detecção roteirizada: devolve o próximo item do script por chamada.
function scripted(script: (LiveMetadata | null)[]): DetectionSource {
	let i = 0
	return { detect: async () => script[i++] ?? null }
}

// recorder fake: registra o streamId e devolve uma promise que NÃO resolve
// (simula gravação em andamento → o Set de idempotência fica populado).
function fakeRecorder(calls: string[]): RecorderContract {
	return {
		record: (streamId: string) => {
			calls.push(streamId)
			return new Promise<RecordingHandle>(() => {})
		},
		listActive: () => [],
	}
}

function withStore(fn: (store: SqliteStore) => Promise<void>) {
	return async () => {
		const root = mkdtempSync(join(tmpdir(), 'mon-'))
		const store = new SqliteStore(root)
		try {
			await fn(store)
		} finally {
			store.close()
			rmSync(root, { recursive: true, force: true })
		}
	}
}

test(
	'go-live + auto_record: registra a stream E dispara o recorder 1×',
	withStore(async store => {
		store.addStreamer({ login: 'x', monitored_since: 1, auto_record: 1 })
		const calls: string[] = []
		const mon = new StreamMonitor({
			store,
			twitch: fakeTwitch(),
			recorder: fakeRecorder(calls),
			detection: scripted([metaFor('A')]),
		})

		await mon.pollNow()
		await flush()

		expect(store.getStream('A')).not.toBeNull()
		expect(store.getStream('A')?.started_at).toBe(1000) // started_at colhido
		expect(mon.getState('x')).toBe('live')
		expect(calls).toEqual(['A'])
	})
)

test(
	'idempotência: blip offline e volta com mesmo stream_id → grava 1× só',
	withStore(async store => {
		store.addStreamer({ login: 'x', monitored_since: 1, auto_record: 1 })
		const calls: string[] = []
		const mon = new StreamMonitor({
			store,
			twitch: fakeTwitch(),
			recorder: fakeRecorder(calls),
			detection: scripted([metaFor('A'), null, metaFor('A')]),
		})

		await mon.pollNow()
		await flush() // live → dispara
		await mon.pollNow()
		await flush() // blip offline
		await mon.pollNow()
		await flush() // volta live (mesmo stream A)

		expect(calls).toEqual(['A']) // o Set bloqueou o re-dispatch
	})
)

test(
	'auto_record=0: registra a stream mas NÃO grava',
	withStore(async store => {
		store.addStreamer({ login: 'x', monitored_since: 1, auto_record: 0 })
		const calls: string[] = []
		const mon = new StreamMonitor({
			store,
			twitch: fakeTwitch(),
			recorder: fakeRecorder(calls),
			detection: scripted([metaFor('A')]),
		})

		await mon.pollNow()
		await flush()

		expect(store.getStream('A')).not.toBeNull()
		expect(calls).toEqual([])
	})
)

test(
	'getState: offline após poll de canal offline',
	withStore(async store => {
		store.addStreamer({ login: 'x', monitored_since: 1, auto_record: 1 })
		const mon = new StreamMonitor({
			store,
			twitch: fakeTwitch(),
			recorder: fakeRecorder([]),
			detection: scripted([null]),
		})

		await mon.pollNow()
		expect(mon.getState('x')).toBe('offline')
	})
)

test(
	'resiliência: um streamer que lança não impede os demais',
	withStore(async store => {
		store.addStreamer({ login: 'bad', monitored_since: 1, auto_record: 1 })
		store.addStreamer({ login: 'good', monitored_since: 1, auto_record: 1 })
		const calls: string[] = []
		const detection: DetectionSource = {
			detect: async login => {
				if (login === 'bad') throw new Error('boom')
				return metaFor('G')
			},
		}
		const mon = new StreamMonitor({
			store,
			twitch: fakeTwitch(),
			recorder: fakeRecorder(calls),
			detection,
		})

		await mon.pollNow() // não deve lançar
		await flush()

		expect(store.getStream('G')).not.toBeNull()
		expect(calls).toEqual(['G'])
	})
)
