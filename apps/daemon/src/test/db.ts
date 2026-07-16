import { DrizzleChannelRepository } from '../database/repositories'
import { applyMigrations, createDrizzle } from '../lib/drizzle'
import { createDatabase } from '../lib/sqlite'

// Helper de teste: DB in-memory com migrations aplicadas + repositório de
// canais pronto. Cobre o único trecho que se repete literal entre testes de
// use case. Se um teste precisar de mais repositórios, monta inline (sem
// crescer esse helper por acumulação).
export function makeTestDb() {
	const db = createDrizzle(createDatabase(':memory:'))
	applyMigrations(db)
	const channelRepository = new DrizzleChannelRepository({ drizzle: db })
	return { db, channelRepository }
}
