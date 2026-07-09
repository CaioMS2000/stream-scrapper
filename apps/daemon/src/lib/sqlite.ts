import { Database } from 'bun:sqlite'

export function createDatabase(url: string): Database {
	return new Database(url)
}
