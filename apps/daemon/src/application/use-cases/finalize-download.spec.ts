import { describe, expect, test } from 'bun:test'
import { DownloadFinalizationFailedError } from '../../@errors'
import { DrizzleDownloadRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { FinalizeDownloadUseCase } from './finalize-download'

function makeUseCase() {
	const { db } = makeTestDb()
	const downloadRepository = new DrizzleDownloadRepository({ drizzle: db })
	const useCase = new FinalizeDownloadUseCase({ downloadRepository })
	return { useCase, downloadRepository }
}

const endedAt = new Date('2026-07-01T12:34:56Z')

describe('FinalizeDownloadUseCase', () => {
	test('completed → row em download ganha status/endedAt', async () => {
		const { useCase, downloadRepository } = makeUseCase()
		await downloadRepository.createDownload({
			streamId: 'sid',
			status: 'downloading',
			storagePath: '/tmp/whatever',
			progress: 1,
		})

		const result = await useCase.execute({
			streamId: 'sid',
			endedAt,
			status: 'completed',
		})

		expect(result.isSuccess()).toBe(true)
		const download = await downloadRepository.findDownloadByStreamId('sid')
		expect(download?.status).toBe('completed')
		expect(download?.endedAt?.toISOString()).toBe(endedAt.toISOString())
	})

	test('failed → row em download reflete status failed', async () => {
		const { useCase, downloadRepository } = makeUseCase()
		await downloadRepository.createDownload({
			streamId: 'sid',
			status: 'downloading',
			storagePath: '/tmp/whatever',
			progress: 0.3,
		})

		const result = await useCase.execute({
			streamId: 'sid',
			endedAt,
			status: 'failed',
		})

		expect(result.isSuccess()).toBe(true)
		const download = await downloadRepository.findDownloadByStreamId('sid')
		expect(download?.status).toBe('failed')
	})

	test('streamId inexistente → DownloadFinalizationFailedError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({
			streamId: 'nao-existe',
			endedAt,
			status: 'completed',
		})

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(DownloadFinalizationFailedError)
	})
})
