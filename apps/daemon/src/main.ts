import { mkdirSync } from 'node:fs'
import { resolveSocketPath } from '@repo/ipc'
import { EventBus } from './@shared/events'
import {
	AddChannelUseCase,
	DisableAutoRecordingUseCase,
	EnableAutoRecordingUseCase,
	FinalizeRecordingUseCase,
	RemoveChannelUseCase,
	StartRecordingUseCase,
	StopRecordingUseCase,
} from './application/use-cases'
import { config } from './config'
import {
	DrizzleChannelRepository,
	DrizzleStreamRepository,
} from './infrastructure/database/repositories'
import { IpcServer } from './infrastructure/ipc'
import { MediaStorage, StreamMetaStorage } from './infrastructure/media-storage'
import {
	ChannelLiveEvent,
	ChannelMonitor,
	ChannelOfflineEvent,
} from './infrastructure/monitor'
import {
	RecordingFailedEvent,
	RecordingFinishedEvent,
	StreamRecorder,
} from './infrastructure/recorder'
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
	// Recebe o bus pra publicar RecordingFinished/FailedEvent no handleExit.
	const recorder = new StreamRecorder({
		twitch,
		storage,
		streamlinkBinPath: config.streamlinkBinPath,
		bus,
	})

	// Storage de arquivos locais 'meta.json'
	const streamMetaStorage = new StreamMetaStorage()

	// Use cases — instanciados no composition root. Comandos são chamados
	// pelo IPC; reactions (start/stop recording) são acionadas via subscribe
	// no bus logo abaixo.
	const addChannel = new AddChannelUseCase({
		twitch,
		channelRepository,
		storage,
	})
	const enableAutoRecording = new EnableAutoRecordingUseCase({
		channelRepository,
	})
	const disableAutoRecording = new DisableAutoRecordingUseCase({
		channelRepository,
	})
	const removeChannel = new RemoveChannelUseCase({
		channelRepository,
		recorder,
	})
	const startRecording = new StartRecordingUseCase({
		streamRepository,
		storage,
		recorder,
		streamMetaStorage,
	})
	const stopRecording = new StopRecordingUseCase({ recorder })
	const finalizeRecording = new FinalizeRecordingUseCase({ streamMetaStorage })

	// Detector — publica eventos no bus, não conhece consumidores
	const monitor = new ChannelMonitor({
		twitch,
		channelRepository,
		bus,
	})

	// ═════════════════════════════════════════════════════════════════════
	// A PONTE Monitor → use cases (via bus)
	// Monitor publica ChannelLiveEvent/ChannelOfflineEvent; os subscribers
	// abaixo são thin adapters que traduzem evento → primitivos → use case.
	// Adicionar novo consumidor (webhook, métrica, audit) = mais linhas
	// aqui, zero mudança em Monitor ou nos use cases.
	// ═════════════════════════════════════════════════════════════════════
	bus.subscribe(ChannelLiveEvent, async event => {
		const result = await startRecording.execute({
			channelName: event.username,
			streamId: event.streamId,
			title: event.title,
			startedAt: event.startedAt,
		})
		if (result.isFailure()) console.error('[start-recording]', result.value)
	})
	bus.subscribe(ChannelOfflineEvent, async event => {
		const result = await stopRecording.execute({ channelName: event.username })
		if (result.isFailure()) console.error('[stop-recording]', result.value)
	})
	bus.subscribe(RecordingFinishedEvent, async event => {
		const result = await finalizeRecording.execute({
			channelName: event.username,
			storagePath: event.storagePath,
			endedAt: event.endedAt,
			bytes: event.bytes,
			status: 'finished',
		})
		if (result.isFailure()) console.error('[finalize-recording]', result.value)
	})
	bus.subscribe(RecordingFailedEvent, async event => {
		const result = await finalizeRecording.execute({
			channelName: event.username,
			storagePath: event.storagePath,
			endedAt: event.endedAt,
			bytes: event.bytes,
			status: 'failed',
		})
		if (result.isFailure()) console.error('[finalize-recording]', result.value)
	})

	monitor.startMonitoring()

	// Camada de IPC: escuta o socket e traduz comandos do CLI em chamadas
	// aos use cases. Cada use case ainda é agnóstico de quem chamou.
	const socketPath = resolveSocketPath()
	const ipc = new IpcServer({
		deps: {
			addChannel,
			enableAutoRecording,
			disableAutoRecording,
			removeChannel,
		},
		socketPath,
	})
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
