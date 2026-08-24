import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamFinalizationFailedError } from '../../@errors'
import { DrizzleRecordingRepository } from '../../infrastructure/database/repositories'
import { StreamMetaStorage } from '../../infrastructure/media-storage'
import { makeTestDb } from '../../test/db'
import { FinalizeRecordingUseCase } from './finalize-recording'

function makeUseCase() {
	const { db } = makeTestDb()
	const recordingRepository = new DrizzleRecordingRepository({ drizzle: db })
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storagePath = join(rootPath, 'lexi/2026-07-01/first(sid)')
	mkdirSync(storagePath, { recursive: true })
	const streamMetaStorage = new StreamMetaStorage()
	// semear meta.json inicial no estado "recording" — como o
	// StartRecordingUseCase teria feito antes do handleExit disparar
	streamMetaStorage.writeStreamMeta({
		storagePath,
		metaFile: streamMetaStorage.toMetaFile({
			streamId: 'sid',
			channelName: 'lexi',
			title: 'first',
			startedAt: new Date('2026-07-01T10:00:00Z'),
			endedAt: undefined,
			quality: 'source',
			status: 'recording',
			bytes: undefined,
		}),
	})
	const useCase = new FinalizeRecordingUseCase({
		streamMetaStorage,
		recordingRepository,
	})
	return { useCase, storagePath, streamMetaStorage, recordingRepository }
}

const endedAt = new Date('2026-07-01T12:34:56Z')

describe('FinalizeRecordingUseCase', () => {
	test('happy finished → meta.json e row em recording ganham endedAt/bytes/status', async () => {
		const { useCase, storagePath, recordingRepository } = makeUseCase()

		// mesmo espírito da semeadura do meta.json: a row em `recording` que o
		// StartRecordingUseCase já teria criado antes do handleExit disparar.
		await recordingRepository.createRecording({
			streamId: 'sid',
			startedAt: new Date('2026-07-01T10:00:00Z'),
			status: 'recording',
			quality: 'source',
			storagePath,
		})

		const result = await useCase.execute({
			channelName: 'lexi',
			streamId: 'sid',
			storagePath,
			endedAt,
			bytes: 12345,
			status: 'finished',
		})

		expect(result.isSuccess()).toBe(true)

		const raw = readFileSync(join(storagePath, 'meta.json'), 'utf8')
		const meta = JSON.parse(raw)

		// patch aplicado no sidecar
		expect(meta.status).toBe('finished')
		expect(meta.bytes).toBe(12345)
		expect(new Date(meta.endedAt).toISOString()).toBe(endedAt.toISOString())

		// campos preexistentes intactos
		expect(meta.streamId).toBe('sid')
		expect(meta.channelName).toBe('lexi')
		expect(meta.title).toBe('first')
		expect(meta.quality).toBe('source')

		// row em `recording` refletindo o mesmo patch
		const recording = await recordingRepository.findRecordingByStreamId('sid')
		expect(recording?.status).toBe('finished')
		expect(recording?.bytes).toBe(12345)
		expect(recording?.endedAt?.toISOString()).toBe(endedAt.toISOString())
	})

	test('happy failed com bytes=undefined → status=failed, bytes ausente no JSON e null na row', async () => {
		const { useCase, storagePath, recordingRepository } = makeUseCase()

		await recordingRepository.createRecording({
			streamId: 'sid',
			startedAt: new Date('2026-07-01T10:00:00Z'),
			status: 'recording',
			quality: 'source',
			storagePath,
		})

		const result = await useCase.execute({
			channelName: 'lexi',
			streamId: 'sid',
			storagePath,
			endedAt,
			bytes: undefined,
			status: 'failed',
		})

		expect(result.isSuccess()).toBe(true)

		const meta = JSON.parse(
			readFileSync(join(storagePath, 'meta.json'), 'utf8')
		)
		expect(meta.status).toBe('failed')
		expect(meta.bytes).toBeUndefined()

		const recording = await recordingRepository.findRecordingByStreamId('sid')
		expect(recording?.status).toBe('failed')
	})

	test('storagePath sem meta.json → StreamFinalizationFailedError com cause ENOENT', async () => {
		const { useCase } = makeUseCase()
		const missingPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-empty-'))

		const result = await useCase.execute({
			channelName: 'lexi',
			streamId: 'sid',
			storagePath: missingPath,
			endedAt,
			bytes: 0,
			status: 'failed',
		})

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(StreamFinalizationFailedError)
		expect((result.value as Error).cause).toBeDefined()
	})
})
