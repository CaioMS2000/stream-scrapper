import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DrizzleRecordingRepository } from '../../infrastructure/database/repositories'
import {
	MediaStorage,
	StreamMetaStorage,
} from '../../infrastructure/media-storage'
import { makeTestDb } from '../../test/db'
import { FakeRecorder } from '../../test/recorder'
import { StartRecordingUseCase } from './start-recording'

function makeUseCase(
	recorderConfig?: ConstructorParameters<typeof FakeRecorder>[0]
) {
	const { db, streamRepository } = makeTestDb()
	const recordingRepository = new DrizzleRecordingRepository({ drizzle: db })
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const streamMetaStorage = new StreamMetaStorage()
	const recorder = new FakeRecorder(recorderConfig)
	const useCase = new StartRecordingUseCase({
		streamRepository,
		recordingRepository,
		storage,
		streamMetaStorage,
		recorder,
	})
	return {
		useCase,
		streamRepository,
		recordingRepository,
		storage,
		recorder,
		rootPath,
	}
}

const baseParams = {
	channelName: 'lexi',
	streamId: '40952121362',
	title: 'first stream',
	startedAt: new Date('2026-07-01T10:00:00Z'),
}

describe('StartRecordingUseCase', () => {
	test('happy path → persiste, escreve meta.json e chama recorder', async () => {
		const { useCase, storage, recordingRepository, recorder, rootPath } =
			makeUseCase()

		const result = await useCase.execute(baseParams)

		expect(result.isSuccess()).toBe(true)

		// recorder foi acionado com o filePath vindo do MediaStorage
		expect(recorder.recordCalls).toHaveLength(1)
		expect(recorder.recordCalls[0]?.channelName).toBe('lexi')
		expect(recorder.recordCalls[0]?.streamId).toBe('40952121362')

		// sidecar meta.json existe e tem o payload esperado
		const { fullPath } = storage.createStreamPath(baseParams)
		const metaPath = join(fullPath, 'meta.json')
		expect(existsSync(metaPath)).toBe(true)
		const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
		expect(meta.streamId).toBe('40952121362')
		expect(meta.channelName).toBe('lexi')
		expect(meta.status).toBe('recording')
		expect(meta.quality).toBe('source')

		// diretório-raiz do canal foi criado sob o rootPath
		expect(existsSync(join(rootPath, 'lexi'))).toBe(true)

		// row em `recording` — DB é fonte queryável em paralelo ao meta.json
		const recording =
			await recordingRepository.findRecordingByStreamId('40952121362')
		expect(recording?.status).toBe('recording')
		expect(recording?.quality).toBe('source')
		expect(recording?.storagePath).toBe(fullPath)
	})

	test('streamId já registrado (ex: Monitor já persistiu) → reusa a stream, não falha', async () => {
		const { useCase, streamRepository, recorder } = makeUseCase()

		// Simula o Monitor já tendo persistido a stream antes do
		// StartRecordingUseCase rodar (fluxo desacoplado: quem detecta a live
		// registra a stream direto, independente de gravar).
		await streamRepository.findOrCreateStream(baseParams)

		const result = await useCase.execute(baseParams)

		expect(result.isSuccess()).toBe(true)
		// A proteção real contra gravação duplicada é do StreamRecorder
		// (activeRecordings), não da unicidade de streamId no repo — aqui o
		// recorder é acionado normalmente.
		expect(recorder.recordCalls).toHaveLength(1)
	})
})
