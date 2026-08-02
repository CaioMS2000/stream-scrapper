import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { DrizzleClient } from './index'

const MIGRATIONS_FOLDER = new URL('../../../.drizzle', import.meta.url).pathname

export function applyMigrations(db: DrizzleClient) {
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}
