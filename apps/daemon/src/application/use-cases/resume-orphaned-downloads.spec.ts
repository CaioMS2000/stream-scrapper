import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DrizzleDownloadRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { FakeVodDownloader } from '../../test/downloader'
import { ResumeOrphanedDownloadsUseCase } from './resume-orphaned-downloads'

function makeUseCase() {
	const { db } = makeTestDb()
	const downloadRepository = new DrizzleDownloadRepository({ drizzle: db })
	const downloader = new FakeVodDownloader()
	const useCase = new ResumeOrphanedDownloadsUseCase({
		downloadRepository,
		downloader,
	})
	return { useCase, downloadRepository, downloader }
}

function makeStoragePath() {
	return mkdtempSync(join(tmpdir(), 'stream-scrapper-resume-test-'))
}

describe('ResumeOrphanedDownloadsUseCase', () => {
	test('lease vencido → retoma com resumeFrom correto e trunca o arquivo', async () => {
		const { useCase, downloadRepository, downloader } = makeUseCase()
		const storagePath = makeStoragePath()
		const outputPath = `${storagePath}/stream.ts`
		writeFileSync(outputPath, Buffer.alloc(20, 'a')) // 20 bytes no disco

		await downloadRepository.createDownload({
			streamId: 's1',
			status: 'downloading',
			storagePath,
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: JSON.stringify(['0.ts', '1.ts', '2.ts']),
		})
		await downloadRepository.updateDownloadByStreamId({
			streamId: 's1',
			segmentIndex: 1,
			byteOffset: 12, // menos que os 20 bytes reais no disco — cauda descartável
			leaseUntil: new Date(Date.now() - 60_000), // vencido
		})

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(1)
		expect(downloader.downloadCalls[0]).toMatchObject({
			streamId: 's1',
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: ['0.ts', '1.ts', '2.ts'],
			destinationPath: storagePath,
			resumeFrom: { segmentIndex: 1, byteOffset: 12 },
		})
		expect(readFileSync(outputPath).length).toBe(12)
	})

	test('lease no futuro → pulado, downloader nunca chamado', async () => {
		const { useCase, downloadRepository, downloader } = makeUseCase()
		const storagePath = makeStoragePath()

		await downloadRepository.createDownload({
			streamId: 's2',
			status: 'downloading',
			storagePath,
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: JSON.stringify(['0.ts']),
		})
		await downloadRepository.updateDownloadByStreamId({
			streamId: 's2',
			leaseUntil: new Date(Date.now() + 60_000), // ainda válido
		})

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(0)
	})

	test('sem lease (row legado) → tratado como órfão, retomado', async () => {
		const { useCase, downloadRepository, downloader } = makeUseCase()
		const storagePath = makeStoragePath()

		await downloadRepository.createDownload({
			streamId: 's3',
			status: 'downloading',
			storagePath,
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: JSON.stringify(['0.ts', '1.ts']),
		})
		// nenhum updateDownloadByStreamId — leaseUntil continua null

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(1)
		expect(downloader.downloadCalls[0]?.resumeFrom).toEqual({
			segmentIndex: 0,
			byteOffset: 0,
		})
	})

	test('sem material persistido (legado de antes desta feature) → marca failed, não retoma', async () => {
		const { useCase, downloadRepository, downloader } = makeUseCase()
		const storagePath = makeStoragePath()

		await downloadRepository.createDownload({
			streamId: 's4',
			status: 'downloading',
			storagePath,
			// sem host/baseUrl/segments
		})

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(0)
		const download = await downloadRepository.findDownloadByStreamId('s4')
		expect(download?.status).toBe('failed')
	})

	test('arquivo ainda não existe no disco → não falha, resume do zero', async () => {
		const { useCase, downloadRepository, downloader } = makeUseCase()
		const storagePath = makeStoragePath() // pasta existe, stream.ts não

		await downloadRepository.createDownload({
			streamId: 's5',
			status: 'downloading',
			storagePath,
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: JSON.stringify(['0.ts']),
		})

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(1)
	})

	test('nenhum download downloading → no-op', async () => {
		const { useCase, downloader } = makeUseCase()

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(0)
	})
})
