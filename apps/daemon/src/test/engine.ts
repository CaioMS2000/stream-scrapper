import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	DrizzleChannelRepository,
	DrizzleStreamRepository,
} from '../database/repositories'
import { Engine } from '../engine'
import { applyMigrations, createDrizzle } from '../lib/drizzle'
import { createDatabase } from '../lib/sqlite'
import { MediaStorage } from '../media-storage'
import { StreamRecorder } from '../recorder'
import { FakeTwitchClient, type GetChannelReturn } from './twitch-client'

export function makeEngine(response: GetChannelReturn) {
	const db = createDrizzle(createDatabase(':memory:'))
	applyMigrations(db)

	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const channelRepository = new DrizzleChannelRepository({ drizzle: db })
	const streamRepository = new DrizzleStreamRepository({ drizzle: db })
	const twitch = new FakeTwitchClient(response)

	// StreamRecorder é stub — não faz nada real, ok pra testes de Engine.
	// Se algum teste precisar assertar chamadas específicas, promover pra
	// FakeRecorder que registra invocations.
	const recorder = new StreamRecorder({ twitch, storage })

	const engine = new Engine({
		twitch,
		channelRepository,
		streamRepository,
		storage,
		recorder,
	})

	return { engine, channelRepository, streamRepository, storage, rootPath }
}
