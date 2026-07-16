import { mkdirSync } from 'node:fs'
import { resolveSocketPath } from '@repo/ipc'
import { EventBus } from './@shared/events'
import { Engine } from './application/engine'
import {
	AddChannelUseCase,
	EnableAutoRecordingUseCase,
} from './application/use-cases'
import { config } from './config'
import {
	DrizzleChannelRepository,
	DrizzleStreamRepository,
} from './infrastructure/database/repositories'
import { IpcServer } from './infrastructure/ipc'
import { MediaStorage } from './infrastructure/media-storage'
import {
	ChannelLiveEvent,
	ChannelMonitor,
	ChannelOfflineEvent,
} from './infrastructure/monitor'
import { StreamRecorder } from './infrastructure/recorder'
import { TwitchClientImpl } from './infrastructure/twitch/client'
import { applyMigrations, createDrizzle } from './lib/drizzle'
import { createDatabase } from './lib/sqlite'

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

	// Executor de gravação — spawna streamlink por canal via child process.
	const recorder = new StreamRecorder({
		twitch,
		storage,
		streamlinkBinPath: config.streamlinkBinPath,
	})

	// Orquestrador — só carrega os event handlers (onStreamStarted/Ended) por
	// enquanto. Comandos migraram pros use cases abaixo; quando os event
	// handlers também migrarem, a Engine some.
	const engine = new Engine({
		streamRepository,
		storage,
		recorder,
	})

	// Use cases (comandos) — instanciados no composition root; o IPC vai passar
	// a rotear pra eles na próxima iteração (hoje só ping existe, por isso
	// ficam sem consumer imediato).
	const addChannel = new AddChannelUseCase({
		twitch,
		channelRepository,
		storage,
	})
	const enableAutoRecording = new EnableAutoRecordingUseCase({
		channelRepository,
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
			// Para todos os streamlink filhos ANTES do IPC — evita deixar
			// child process órfão se o kernel bater no daemon logo depois.
			await recorder.stopAll()
			// Fecha o listener e remove o arquivo de socket pra não deixar órfão.
			await ipc.close()
			resolve()
		}

		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
	})
}

await main()
