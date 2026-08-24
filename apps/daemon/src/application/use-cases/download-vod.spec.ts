import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CdnResolution } from '../../infrastructure/cdn-recovery'
import { DrizzleDownloadRepository } from '../../infrastructure/database/repositories'
import { MediaStorage } from '../../infrastructure/media-storage'
import { makeTestDb } from '../../test/db'
import { FakeVodDownloader } from '../../test/downloader'
import { DownloadVodUseCase } from './download-vod'

const FOUND_RESOLUTION: CdnResolution = {
	host: 'fake-host.cloudfront.net',
	baseUrl:
		'https://fake-host.cloudfront.net/abc_lexi_40952121362_1751364000/chunked',
	segments: ['0.ts', '1.ts', '2.ts'],
}

function makeUseCase(options?: {
	downloaderConfig?: ConstructorParameters<typeof FakeVodDownloader>[0]
	resolveVod?: () => Promise<CdnResolution | null>
}) {
	const { db, streamRepository } = makeTestDb()
	const downloadRepository = new DrizzleDownloadRepository({ drizzle: db })
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const downloader = new FakeVodDownloader(options?.downloaderConfig)
	const resolveVod = options?.resolveVod ?? (async () => FOUND_RESOLUTION)

	const useCase = new DownloadVodUseCase({
		streamRepository,
		downloadRepository,
		storage,
		downloader,
		resolveVod,
	})

	return { useCase, streamRepository, downloadRepository, storage, downloader }
}

const baseStream = {
	channelName: 'lexi',
	streamId: '40952121362',
	title: 'first stream',
	startedAt: new Date('2026-07-01T10:00:00Z'),
}

describe('DownloadVodUseCase', () => {
	test('happy path → cria download row e chama o downloader', async () => {
		const { useCase, streamRepository, downloadRepository, downloader } =
			makeUseCase()
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(1)
		expect(downloader.downloadCalls[0]?.baseUrl).toBe(FOUND_RESOLUTION.baseUrl)
		expect(downloader.downloadCalls[0]?.segments).toEqual(
			FOUND_RESOLUTION.segments
		)

		const download = await downloadRepository.findDownloadByStreamId(
			baseStream.streamId
		)
		expect(download?.status).toBe('downloading')
	})

	test('stream inexistente → falha sem tentar resolver/baixar', async () => {
		const { useCase, downloader } = makeUseCase()

		const result = await useCase.execute({ streamId: 'nao-existe' })

		expect(result.isFailure()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(0)
	})

	test('teto de capacidade cheio → falha antes de resolver via CDN', async () => {
		let resolveCalled = false
		const { useCase, streamRepository } = makeUseCase({
			downloaderConfig: { hasCapacity: false },
			resolveVod: async () => {
				resolveCalled = true
				return FOUND_RESOLUTION
			},
		})
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isFailure()).toBe(true)
		expect(resolveCalled).toBe(false)
	})

	test('CDN não encontra nada → falha, nenhum download row criado', async () => {
		const { useCase, streamRepository, downloadRepository } = makeUseCase({
			resolveVod: async () => null,
		})
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isFailure()).toBe(true)
		const download = await downloadRepository.findDownloadByStreamId(
			baseStream.streamId
		)
		expect(download).toBeNull()
	})

	test('duas execuções concorrentes pro mesmo streamId → só uma cria download ativo', async () => {
		// Diverge do doc 001 de propósito: aqui não há garantia de que os
		// gatilhos sejam sequenciais (doc 001 se apoia no Monitor ser
		// sequencial), então a idempotência precisa vir do índice único
		// parcial no banco, não de checagem antecipada em memória — ver
		// docs/design/002-download-de-vods.md, Risco #4.
		const { useCase, streamRepository } = makeUseCase()
		await streamRepository.createStream(baseStream)

		const [first, second] = await Promise.all([
			useCase.execute({ streamId: baseStream.streamId }),
			useCase.execute({ streamId: baseStream.streamId }),
		])

		const successes = [first, second].filter(r => r.isSuccess())
		const failures = [first, second].filter(r => r.isFailure())
		expect(successes).toHaveLength(1)
		expect(failures).toHaveLength(1)
	})
})
