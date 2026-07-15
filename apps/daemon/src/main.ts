import { mkdirSync } from 'node:fs'
import { resolveSocketPath } from '@repo/ipc'
import { EventBus } from './@shared/events'
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
import {
	ChannelLiveEvent,
	ChannelMonitor,
	ChannelOfflineEvent,
} from './monitor'
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

	// Bus central — uma única instância compartilhada por todos os
	// produtores/consumidores de eventos do daemon.
	const bus = new EventBus()

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

	// Detector — publica eventos no bus, não conhece consumidores
	const monitor = new ChannelMonitor({
		twitch,
		channelRepository,
		bus,
	})

	// ═════════════════════════════════════════════════════════════════════
	// A PONTE Monitor → Engine (via bus)
	// Monitor publica ChannelLiveEvent/ChannelOfflineEvent; Engine se
	// inscreveu abaixo pra reagir. Adicionar novo consumidor (webhook,
	// métrica, audit) = mais linhas aqui, zero mudança em Monitor.
	// ═════════════════════════════════════════════════════════════════════
	bus.subscribe(ChannelLiveEvent, event => engine.onStreamStarted(event))
	bus.subscribe(ChannelOfflineEvent, event => engine.onStreamEnded(event))

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
