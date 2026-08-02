import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamFinalizationFailedError } from '../../@errors'
import { StreamMetaStorage } from '../../infrastructure/media-storage'
import { FinalizeRecordingUseCase } from './finalize-recording'

function makeUseCase() {
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
	const useCase = new FinalizeRecordingUseCase({ streamMetaStorage })
	return { useCase, storagePath, streamMetaStorage }
}

const endedAt = new Date('2026-07-01T12:34:56Z')

describe('FinalizeRecordingUseCase', () => {
	test('happy finished → meta.json ganha endedAt/bytes/status sem perder campos preexistentes', async () => {
		const { useCase, storagePath } = makeUseCase()

		const result = await useCase.execute({
			channelName: 'lexi',
			storagePath,
			endedAt,
			bytes: 12345,
			status: 'finished',
		})

		expect(result.isSuccess()).toBe(true)

		const raw = readFileSync(join(storagePath, 'meta.json'), 'utf8')
		const meta = JSON.parse(raw)

		// patch aplicado
		expect(meta.status).toBe('finished')
		expect(meta.bytes).toBe(12345)
		expect(new Date(meta.endedAt).toISOString()).toBe(endedAt.toISOString())

		// campos preexistentes intactos
		expect(meta.streamId).toBe('sid')
		expect(meta.channelName).toBe('lexi')
		expect(meta.title).toBe('first')
		expect(meta.quality).toBe('source')
	})

	test('happy failed com bytes=undefined → status=failed, bytes ausente no JSON', async () => {
		const { useCase, storagePath } = makeUseCase()

		const result = await useCase.execute({
			channelName: 'lexi',
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
	})

	test('storagePath sem meta.json → StreamFinalizationFailedError com cause ENOENT', async () => {
		const { useCase } = makeUseCase()
		const missingPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-empty-'))

		const result = await useCase.execute({
			channelName: 'lexi',
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
