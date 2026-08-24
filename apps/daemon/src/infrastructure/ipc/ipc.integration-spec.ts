// Teste de integração da camada IPC: spawna um IpcServer real (via
// Bun.listen, socket em tmp) + use cases reais + DB in-memory + Twitch fake,
// e conecta clientes por Bun.connect enviando/recebendo pelo wire de
// verdade. Cobre: framing (LineBuffer/encodeMessage), dispatch tipada do
// router, contrato dos schemas Zod entre daemon e CLI, e o round-trip de
// respostas de erro (ok:false).
//
// FORA de escopo: comportamento do binário CLI (parsing do commander,
// formatação humana do output). Isso é responsabilidade do smoke E2E.
//
// Descoberta: este arquivo NÃO é *.spec.ts nem *.test.ts, então `bun test`
// puro não vai pegá-lo. Invocação explícita pelo script test:integration.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	encodeMessage,
	type IpcRequest,
	IpcResponse,
	LineBuffer,
} from '@repo/ipc'
import {
	AddChannelUseCase,
	DisableAutoRecordingUseCase,
	EnableAutoRecordingUseCase,
	ForceRecordUseCase,
	ListChannelsUseCase,
	RemoveChannelUseCase,
	StartRecordingUseCase,
} from '../../application/use-cases'
import { applyMigrations, createDrizzle } from '../../lib/drizzle'
import { createDatabase } from '../../lib/sqlite'
import { success } from '../../result'
import { FakeRecorder } from '../../test/recorder'
import { FakeTwitchClient } from '../../test/twitch-client'
import {
	DrizzleChannelRepository,
	DrizzleStreamRepository,
} from '../database/repositories'
import { MediaStorage, StreamMetaStorage } from '../media-storage'
import { IpcServer } from './server'

// Cliente mini pra teste: mimica o que o IpcClient do apps/cli faz, mas
// inline. O contrato do wire (framing + schemas) mora no @repo/ipc — testar
// contra ele cobre o mesmo contrato que o CLI real usa, sem cross-import
// entre apps.
async function sendCommand(
	socketPath: string,
	request: IpcRequest
): Promise<IpcResponse> {
	const lineBuffer = new LineBuffer()
	const { promise, resolve, reject } = Promise.withResolvers<IpcResponse>()

	try {
		await Bun.connect({
			unix: socketPath,
			socket: {
				open: socket => {
					socket.write(encodeMessage(request))
				},
				data: (socket, chunk) => {
					const [line] = lineBuffer.push(chunk.toString())
					if (!line) return
					socket.end()
					try {
						resolve(IpcResponse.parse(JSON.parse(line)))
					} catch (err) {
						reject(err)
					}
				},
				error: (_socket, err) => reject(err),
			},
		})
	} catch (err) {
		reject(err)
	}

	return promise
}

describe('IPC integration', () => {
	let server: IpcServer
	let tmpDir: string
	let socketPath: string
	let channelRepository: DrizzleChannelRepository
	let recorder: FakeRecorder

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'scrapper-integration-'))
		socketPath = join(tmpDir, 'ipc.sock')

		const db = createDrizzle(createDatabase(':memory:'))
		applyMigrations(db)
		channelRepository = new DrizzleChannelRepository({ drizzle: db })
		const streamRepository = new DrizzleStreamRepository({ drizzle: db })
		const storage = new MediaStorage({ rootPath: tmpDir })
		const streamMetaStorage = new StreamMetaStorage()
		const twitch = new FakeTwitchClient(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: 'https://example.test/lexi.png',
				stream: null,
			})
		)

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
		recorder = new FakeRecorder()
		const removeChannel = new RemoveChannelUseCase({
			channelRepository,
			recorder,
		})
		const listChannels = new ListChannelsUseCase({
			channelRepository,
			recorder,
		})
		const startRecording = new StartRecordingUseCase({
			streamRepository,
			storage,
			recorder,
			streamMetaStorage,
		})
		const startRecord = new ForceRecordUseCase({
			channelRepository,
			twitch,
			startRecording,
		})

		server = new IpcServer({
			deps: {
				addChannel,
				enableAutoRecording,
				disableAutoRecording,
				removeChannel,
				listChannels,
				startRecord,
			},
			socketPath,
		})
		await server.listen()
	})

	afterEach(async () => {
		await server.close()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test('ping → uptime numérico', async () => {
		const res = await sendCommand(socketPath, { cmd: 'ping' })
		expect(res).toMatchObject({ ok: true, cmd: 'ping' })
		if (res.ok && res.cmd === 'ping') {
			expect(typeof res.uptime).toBe('number')
		}
	})

	test('add-channel novo → sucesso + row persistido', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'add-channel',
			username: 'lexi',
		})
		expect(res).toEqual({
			ok: true,
			cmd: 'add-channel',
			channel: { username: 'lexi', recording: false },
		})
		const persisted = await channelRepository.findChannel('lexi')
		expect(persisted).not.toBeNull()
		expect(persisted?.username).toBe('lexi')
	})

	test('add-channel duplicata → envelope de erro roundtrip', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		const res = await sendCommand(socketPath, {
			cmd: 'add-channel',
			username: 'lexi',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/already registered/i)
		}
	})

	test('enable-auto-recording num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'enable-auto-recording',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('enable-auto-recording após add-channel → flipa autoRecord na DB', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		expect((await channelRepository.findChannel('lexi'))?.autoRecord).toBe(
			false
		)

		const res = await sendCommand(socketPath, {
			cmd: 'enable-auto-recording',
			username: 'lexi',
		})
		expect(res).toEqual({ ok: true, cmd: 'enable-auto-recording' })

		expect((await channelRepository.findChannel('lexi'))?.autoRecord).toBe(true)
	})

	test('disable-auto-recording num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'disable-auto-recording',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('disable-auto-recording após enable-auto-recording → flipa autoRecord na DB', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		await sendCommand(socketPath, {
			cmd: 'enable-auto-recording',
			username: 'lexi',
		})
		expect((await channelRepository.findChannel('lexi'))?.autoRecord).toBe(true)

		const res = await sendCommand(socketPath, {
			cmd: 'disable-auto-recording',
			username: 'lexi',
		})
		expect(res).toEqual({ ok: true, cmd: 'disable-auto-recording' })

		expect((await channelRepository.findChannel('lexi'))?.autoRecord).toBe(
			false
		)
	})

	test('remove-channel num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'remove-channel',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('remove-channel sem gravação ativa → sucesso + row removida', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })

		const res = await sendCommand(socketPath, {
			cmd: 'remove-channel',
			username: 'lexi',
		})
		expect(res).toEqual({ ok: true, cmd: 'remove-channel' })

		expect(await channelRepository.findChannel('lexi')).toBeNull()
	})

	test('remove-channel com gravação ativa → envelope de erro, row permanece', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		recorder.recording.add('lexi')

		const res = await sendCommand(socketPath, {
			cmd: 'remove-channel',
			username: 'lexi',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/recording is in progress/i)
		}

		expect(await channelRepository.findChannel('lexi')).not.toBeNull()
	})

	test('list-channels sem canais cadastrados → lista vazia', async () => {
		const res = await sendCommand(socketPath, { cmd: 'list-channels' })
		expect(res).toEqual({ ok: true, cmd: 'list-channels', channels: [] })
	})

	test('list-channels reflete auto-record e gravação ativa', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		await sendCommand(socketPath, {
			cmd: 'enable-auto-recording',
			username: 'lexi',
		})
		recorder.recording.add('lexi')

		const res = await sendCommand(socketPath, { cmd: 'list-channels' })
		expect(res).toEqual({
			ok: true,
			cmd: 'list-channels',
			channels: [
				{
					username: 'lexi',
					displayName: 'Lexi',
					isLive: false,
					isRecording: true,
					autoRecord: true,
				},
			],
		})
	})

	test('start-record num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'start-record',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('start-record num canal cadastrado mas offline → envelope de erro', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })

		const res = await sendCommand(socketPath, {
			cmd: 'start-record',
			username: 'lexi',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not live/i)
		}
	})
})
