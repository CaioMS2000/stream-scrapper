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
	ChannelDetailsUseCase,
	DisableAutoRecordingUseCase,
	DownloadVodUseCase,
	EnableAutoRecordingUseCase,
	ForceRecordUseCase,
	ForceStopUseCase,
	ListChannelsUseCase,
	RemoveChannelUseCase,
	StartRecordingUseCase,
	StopRecordingUseCase,
} from '../../application/use-cases'
import { applyMigrations, createDrizzle } from '../../lib/drizzle'
import { createDatabase } from '../../lib/sqlite'
import { success } from '../../result'
import { FakeVodDownloader } from '../../test/downloader'
import { FakeRecorder } from '../../test/recorder'
import { FakeTwitchClient } from '../../test/twitch-client'
import type { CdnResolution } from '../cdn-recovery'
import {
	DrizzleChannelRepository,
	DrizzleDownloadRepository,
	DrizzleRecordingRepository,
	DrizzleStreamRepository,
} from '../database/repositories'
import { MediaStorage, StreamMetaStorage } from '../media-storage'
import { IpcServer } from './server'

const FAKE_CDN_RESOLUTION: CdnResolution = {
	host: 'fake-host.cloudfront.net',
	baseUrl: 'https://fake-host.cloudfront.net/abc_lexi_sid_123/chunked',
	segments: ['0.ts'],
}

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
	let streamRepository: DrizzleStreamRepository
	let recordingRepository: DrizzleRecordingRepository
	let downloadRepository: DrizzleDownloadRepository
	let recorder: FakeRecorder
	let vodDownloader: FakeVodDownloader

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'scrapper-integration-'))
		socketPath = join(tmpDir, 'ipc.sock')

		const db = createDrizzle(createDatabase(':memory:'))
		applyMigrations(db)
		channelRepository = new DrizzleChannelRepository({ drizzle: db })
		streamRepository = new DrizzleStreamRepository({ drizzle: db })
		recordingRepository = new DrizzleRecordingRepository({
			drizzle: db,
		})
		downloadRepository = new DrizzleDownloadRepository({ drizzle: db })
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
			recordingRepository,
			storage,
			recorder,
			streamMetaStorage,
		})
		const startRecord = new ForceRecordUseCase({
			channelRepository,
			twitch,
			startRecording,
		})
		const stopRecording = new StopRecordingUseCase({ recorder })
		const stopRecord = new ForceStopUseCase({
			channelRepository,
			recorder,
			stopRecording,
		})
		const channelDetails = new ChannelDetailsUseCase({
			channelRepository,
			streamRepository,
			recordingRepository,
		})
		vodDownloader = new FakeVodDownloader()
		const downloadVod = new DownloadVodUseCase({
			streamRepository,
			downloadRepository,
			channelRepository,
			storage,
			downloader: vodDownloader,
			resolveCdn: async () => FAKE_CDN_RESOLUTION,
			resolveOfficial: async () => null,
		})

		server = new IpcServer({
			deps: {
				addChannel,
				enableAutoRecording,
				disableAutoRecording,
				removeChannel,
				listChannels,
				startRecord,
				stopRecord,
				channelDetails,
				downloadVod,
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

	test('stop-record num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'stop-record',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('stop-record num canal cadastrado sem gravação ativa → envelope de erro', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })

		const res = await sendCommand(socketPath, {
			cmd: 'stop-record',
			username: 'lexi',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not currently recording/i)
		}
	})

	test('stop-record num canal com gravação ativa → sucesso, chama recorder.stopStream', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		recorder.recording.add('lexi')

		const res = await sendCommand(socketPath, {
			cmd: 'stop-record',
			username: 'lexi',
		})
		expect(res).toEqual({ ok: true, cmd: 'stop-record' })
		expect(recorder.stopCalls).toEqual(['lexi'])
	})

	test('channel-details num canal inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'channel-details',
			username: 'ghost',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
	})

	test('channel-details com stream sem gravação → recording null no wire', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		await streamRepository.findOrCreateStream({
			streamId: 'sid-no-rec',
			channelName: 'lexi',
			title: 'sem gravação',
			startedAt: new Date('2026-07-01T10:00:00Z'),
		})

		const res = await sendCommand(socketPath, {
			cmd: 'channel-details',
			username: 'lexi',
		})
		expect(res.ok).toBe(true)
		if (!res.ok || res.cmd !== 'channel-details') return

		expect(res.channel.username).toBe('lexi')
		expect(res.streams).toHaveLength(1)
		expect(res.streams[0]?.streamId).toBe('sid-no-rec')
		expect(res.streams[0]?.recording).toBeNull()
	})

	test('channel-details com stream gravada → recording preenchido, datas fazem round-trip', async () => {
		await sendCommand(socketPath, { cmd: 'add-channel', username: 'lexi' })
		await streamRepository.findOrCreateStream({
			streamId: 'sid-rec',
			channelName: 'lexi',
			title: 'com gravação',
			startedAt: new Date('2026-07-01T10:00:00Z'),
		})
		const endedAt = new Date('2026-07-01T12:00:00Z')
		await recordingRepository.createRecording({
			streamId: 'sid-rec',
			startedAt: new Date('2026-07-01T10:00:00Z'),
			status: 'finished',
			quality: 'source',
			storagePath: '/data/lexi/2026-07-01/com-gravacao(sid-rec)',
			bytes: 999,
		})
		await recordingRepository.updateRecordingByStreamId({
			streamId: 'sid-rec',
			endedAt,
			status: 'finished',
			bytes: 999,
		})

		const res = await sendCommand(socketPath, {
			cmd: 'channel-details',
			username: 'lexi',
		})
		expect(res.ok).toBe(true)
		if (!res.ok || res.cmd !== 'channel-details') return

		const stream = res.streams[0]
		expect(stream?.recording?.status).toBe('finished')
		expect(stream?.recording?.bytes).toBe(999)
		expect(stream?.recording?.endedAt).toBeInstanceOf(Date)
		expect(stream?.recording?.endedAt?.toISOString()).toBe(
			endedAt.toISOString()
		)
	})

	test('download-vod pra streamId inexistente → envelope de erro', async () => {
		const res = await sendCommand(socketPath, {
			cmd: 'download-vod',
			streamId: 'ghost-stream',
		})
		expect(res.ok).toBe(false)
		if (!res.ok) {
			expect(res.error).toMatch(/not found/i)
		}
		expect(vodDownloader.downloadCalls).toHaveLength(0)
	})

	test('download-vod pra stream registrada → sucesso, cria download row e chama o downloader', async () => {
		await streamRepository.findOrCreateStream({
			streamId: 'sid-vod',
			channelName: 'lexi',
			title: 'vod stream',
			startedAt: new Date('2026-07-01T10:00:00Z'),
		})

		const res = await sendCommand(socketPath, {
			cmd: 'download-vod',
			streamId: 'sid-vod',
		})
		expect(res).toEqual({ ok: true, cmd: 'download-vod' })

		expect(vodDownloader.downloadCalls).toHaveLength(1)
		expect(vodDownloader.downloadCalls[0]?.baseUrl).toBe(
			FAKE_CDN_RESOLUTION.baseUrl
		)

		const download = await downloadRepository.findDownloadByStreamId('sid-vod')
		expect(download?.status).toBe('downloading')
	})
})
