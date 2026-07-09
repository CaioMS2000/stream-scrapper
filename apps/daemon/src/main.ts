import { mkdirSync } from 'node:fs'
import { resolveSocketPath } from '@repo/ipc'
import { config } from './config'
import { Engine } from './engine'
import { IpcServer } from './ipc'
import { createDrizzle } from './lib/drizzle'
import { createDatabase } from './lib/sqlite'
import { Store } from './store'
import { TwitchClientImpl } from './twitch/client'

console.log(`daemon started (pid ${process.pid})`)
async function main() {
	// Ordem importa: o diretório precisa existir ANTES de abrir o banco —
	// bun:sqlite cria o arquivo .db sozinho, mas não a pasta pai (SQLITE_CANTOPEN).
	mkdirSync(config.dataDir, { recursive: true })
	const store = new Store({
		rootPath: config.dataDir,
		drizzle: createDrizzle(createDatabase(config.databasePath)),
	})
	const twitch = new TwitchClientImpl()
	const engine = new Engine({ twitch, store })

	// Camada de IPC: escuta o socket e traduz comandos do CLI em chamadas à
	// Engine. A Engine continua agnóstica de quem chamou.
	const socketPath = resolveSocketPath()
	const ipc = new IpcServer({ engine, socketPath })
	await ipc.listen()
	console.log(`ipc listening at ${socketPath}`)

	await new Promise<void>(resolve => {
		const shutdown = async (signal: NodeJS.Signals) => {
			console.log(`\nreceived ${signal}, shutting down...`)
			// Fecha o listener e remove o arquivo de socket pra não deixar órfão.
			await ipc.close()
			resolve()
		}

		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
	})
}

await main()
