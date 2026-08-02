import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamRecordingFailedError } from '../../@errors'
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
	const { streamRepository } = makeTestDb()
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const streamMetaStorage = new StreamMetaStorage()
	const recorder = new FakeRecorder(recorderConfig)
	const useCase = new StartRecordingUseCase({
		streamRepository,
		storage,
		streamMetaStorage,
		recorder,
	})
	return { useCase, streamRepository, storage, recorder, rootPath }
}

const baseParams = {
	channelName: 'lexi',
	streamId: '40952121362',
	title: 'first stream',
	startedAt: new Date('2026-07-01T10:00:00Z'),
}

describe('StartRecordingUseCase', () => {
	test('happy path → persiste, escreve meta.json e chama recorder', async () => {
		const { useCase, storage, recorder, rootPath } = makeUseCase()

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
	})

	test('streamId duplicado → falha com StreamRecordingFailedError carregando cause', async () => {
		const { useCase, recorder } = makeUseCase()

		// primeira execução: sucesso
		const first = await useCase.execute(baseParams)
		expect(first.isSuccess()).toBe(true)

		// segunda execução com mesmo streamId → UNIQUE constraint no repo
		const second = await useCase.execute(baseParams)

		expect(second.isFailure()).toBe(true)
		expect(second.value).toBeInstanceOf(StreamRecordingFailedError)
		// cause preservado — provando que o subscriber pode inspecionar
		expect((second.value as Error).cause).toBeDefined()

		// recorder não foi chamado uma segunda vez
		expect(recorder.recordCalls).toHaveLength(1)
	})
})
