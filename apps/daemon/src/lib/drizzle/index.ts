import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

export function createDrizzle(url: string) {
	const sqlite = new Database(url)

	return drizzle({
		client: sqlite,
	})
}

export type DrizzleClient = ReturnType<typeof createDrizzle>
