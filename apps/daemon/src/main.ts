import { mkdirSync } from 'node:fs'
import { resolveSocketPath } from '@repo/ipc'
import { config } from './config'
import {
	DrizzleChannelRepository,
	DrizzleStreamRepository,
} from './database/repositories'
import { Engine } from './engine'
import { IpcServer } from './ipc'
import { applyMigrations, createDrizzle } from './lib/drizzle'
import { createDatabase } from './lib/sqlite'
import { MediaStorage } from './media-storage'
import { ChannelMonitor } from './monitor'
import { StreamRecorder } from './recorder'
import { TwitchClientImpl } from './twitch/client'

console.log(`daemon started (pid ${process.pid})`)

async function main() {
	// Ordem importa: o diretório precisa existir ANTES de abrir o banco —
	// bun:sqlite cria o arquivo .db sozinho, mas não a pasta pai (SQLITE_CANTOPEN).
	mkdirSync(config.dataDir, { recursive: true })

	// Infra ────────────────────────────────────────────────────────────────
	const db = createDrizzle(createDatabase(config.databasePath))
	applyMigrations(db)

	// Persistência ─────────────────────────────────────────────────────────
	const storage = new MediaStorage({ rootPath: config.dataDir })
	const channelRepository = new DrizzleChannelRepository({ drizzle: db })
	const streamRepository = new DrizzleStreamRepository({ drizzle: db })

	// Serviços externos ────────────────────────────────────────────────────
	const twitch = new TwitchClientImpl()

	// Executor de gravação (stub por enquanto)
	const recorder = new StreamRecorder({ twitch, storage })

	// Orquestrador — recebe todas as peças que ele coordena
	const engine = new Engine({
		twitch,
		channelRepository,
		streamRepository,
		storage,
		recorder,
	})

	// Detector — Emitter próprio criado pelo default (não compartilhado).
	// Ver JSDoc em ChannelMonitorProps.events.
	const monitor = new ChannelMonitor({
		twitch,
		channelRepository,
	})

	// ═════════════════════════════════════════════════════════════════════
	// A PONTE Monitor → Engine (via evento)
	// Este listener é o único ponto onde Monitor e Engine se cruzam.
	// Monitor não conhece Engine; Engine não conhece Monitor. `main.ts` é
	// o "carteiro" que amarra os dois via a shape do evento.
	// ═════════════════════════════════════════════════════════════════════
	monitor.on(async event => {
		if (event.type === 'live') {
			await engine.onStreamStarted(event)
		} else {
			await engine.onStreamEnded(event)
		}
	})

	monitor.startMonitoring()

	// Camada de IPC: escuta o socket e traduz comandos do CLI em chamadas à
	// Engine. A Engine continua agnóstica de quem chamou.
	const socketPath = resolveSocketPath()
	const ipc = new IpcServer({ engine, socketPath })
	await ipc.listen()
	console.log(`ipc listening at ${socketPath}`)

	// Shutdown limpo ───────────────────────────────────────────────────────
	await new Promise<void>(resolve => {
		const shutdown = async (signal: NodeJS.Signals) => {
			console.log(`\nreceived ${signal}, shutting down...`)
			monitor.stop()
			// Fecha o listener e remove o arquivo de socket pra não deixar órfão.
			await ipc.close()
			resolve()
		}

		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
	})
}

await main()
