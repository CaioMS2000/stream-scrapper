import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../engine'
import { applyMigrations, createDrizzle } from '../lib/drizzle'
import { createDatabase } from '../lib/sqlite'
import { Store } from '../store/store'
import { type CheckChannelReturn, FakeTwitchClient } from './twitch-client'

export function makeEngine(response: CheckChannelReturn) {
	const db = createDrizzle(createDatabase(':memory:'))
	applyMigrations(db)
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const store = new Store({ drizzle: db, rootPath })
	const twitch = new FakeTwitchClient(response)
	const engine = new Engine({ twitch, store })
	return { engine, store, rootPath }
}
