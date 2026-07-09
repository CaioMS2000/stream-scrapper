import type { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

export function createDrizzle(sqlite: Database) {
	return drizzle({
		client: sqlite,
	})
}

export type DrizzleClient = ReturnType<typeof createDrizzle>
