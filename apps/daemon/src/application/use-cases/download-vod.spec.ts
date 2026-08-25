import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CdnHostRepository } from '../../application/repositories'
import type { CdnResolution } from '../../infrastructure/cdn-recovery'
import { seedKnownCdnHosts } from '../../infrastructure/cdn-recovery'
import {
	DrizzleCdnHostRepository,
	DrizzleDownloadRepository,
} from '../../infrastructure/database/repositories'
import { MediaStorage } from '../../infrastructure/media-storage'
import type { OfficialVodResolution } from '../../infrastructure/official-vod'
import { makeTestDb } from '../../test/db'
import { FakeVodDownloader } from '../../test/downloader'
import { DownloadVodUseCase, type ResolveOfficialFn } from './download-vod'

const FOUND_RESOLUTION: CdnResolution = {
	host: 'fake-host.cloudfront.net',
	baseUrl:
		'https://fake-host.cloudfront.net/abc_lexi_40952121362_1751364000/chunked',
	segments: ['0.ts', '1.ts', '2.ts'],
}

const FOUND_OFFICIAL_RESOLUTION: OfficialVodResolution = {
	host: 'd3fi1amfgojobc.cloudfront.net',
	baseUrl: 'https://d3fi1amfgojobc.cloudfront.net/vod123/chunked',
	segments: ['0.ts', '1.ts'],
}

function makeUseCase(options?: {
	downloaderConfig?: ConstructorParameters<typeof FakeVodDownloader>[0]
	resolveCdn?: () => Promise<CdnResolution | null>
	resolveOfficial?: ResolveOfficialFn
	cdnHostRepository?: CdnHostRepository
}) {
	const { db, streamRepository, channelRepository } = makeTestDb()
	const downloadRepository = new DrizzleDownloadRepository({ drizzle: db })
	// Não cresce test/db.ts por acumulação (comentário do próprio arquivo) —
	// repositório extra montado inline, reusando o `db` já migrado.
	const cdnHostRepository =
		options?.cdnHostRepository ?? new DrizzleCdnHostRepository({ drizzle: db })
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const downloader = new FakeVodDownloader(options?.downloaderConfig)
	const resolveCdn = options?.resolveCdn ?? (async () => FOUND_RESOLUTION)
	const resolveOfficial = options?.resolveOfficial ?? (async () => null)

	const useCase = new DownloadVodUseCase({
		streamRepository,
		downloadRepository,
		channelRepository,
		cdnHostRepository,
		storage,
		downloader,
		resolveCdn,
		resolveOfficial,
	})

	return {
		useCase,
		streamRepository,
		channelRepository,
		downloadRepository,
		cdnHostRepository,
		storage,
		downloader,
	}
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
			resolveCdn: async () => {
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
			resolveCdn: async () => null,
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

	test('stream sem vodId (VodLinker ainda não achou) → nunca tenta o caminho oficial, vai direto pro CDN', async () => {
		let officialCalled = false
		const { useCase, streamRepository, downloader } = makeUseCase({
			resolveOfficial: async () => {
				officialCalled = true
				return FOUND_OFFICIAL_RESOLUTION
			},
		})
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		expect(officialCalled).toBe(false)
		expect(downloader.downloadCalls[0]?.baseUrl).toBe(FOUND_RESOLUTION.baseUrl)
	})

	test('stream com vodId + caminho oficial resolve → usa a resolução oficial, CDN nunca é chamado', async () => {
		let cdnCalled = false
		const { useCase, streamRepository, downloader } = makeUseCase({
			resolveCdn: async () => {
				cdnCalled = true
				return FOUND_RESOLUTION
			},
			resolveOfficial: async () => FOUND_OFFICIAL_RESOLUTION,
		})
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'vod123',
			vodLookupStatus: 'linked',
		})

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		expect(cdnCalled).toBe(false)
		expect(downloader.downloadCalls[0]?.baseUrl).toBe(
			FOUND_OFFICIAL_RESOLUTION.baseUrl
		)
	})

	test('stream com vodId + caminho oficial não resolve → cai pro CDN', async () => {
		const { useCase, streamRepository, downloader } = makeUseCase({
			resolveOfficial: async () => null,
		})
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'vod123',
			vodLookupStatus: 'linked',
		})

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls[0]?.baseUrl).toBe(FOUND_RESOLUTION.baseUrl)
	})

	test('vodId presente, oficial E CDN falham → VodNotRecoverableError, nenhum download row', async () => {
		const { useCase, streamRepository, downloadRepository } = makeUseCase({
			resolveCdn: async () => null,
			resolveOfficial: async () => null,
		})
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'vod123',
			vodLookupStatus: 'linked',
		})

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isFailure()).toBe(true)
		const download = await downloadRepository.findDownloadByStreamId(
			baseStream.streamId
		)
		expect(download).toBeNull()
	})

	test('qualityPref do canal é repassado pro resolveOfficial', async () => {
		const receivedParams: { vodId: string; qualityPref: string }[] = []
		const { useCase, streamRepository, channelRepository } = makeUseCase({
			resolveOfficial: async params => {
				receivedParams.push(params)
				return FOUND_OFFICIAL_RESOLUTION
			},
		})
		await channelRepository.addChannel(baseStream.channelName, {
			name: 'Lexi',
			qualityPref: '720p',
		})
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'vod123',
			vodLookupStatus: 'linked',
		})

		await useCase.execute({ streamId: baseStream.streamId })

		expect(receivedParams).toEqual([{ vodId: 'vod123', qualityPref: '720p' }])
	})

	test('seedKnownCdnHosts popula a tabela com os hosts conhecidos', async () => {
		const { cdnHostRepository } = makeUseCase()

		await seedKnownCdnHosts(cdnHostRepository)
		const hosts = await cdnHostRepository.listHosts()

		expect(hosts.length).toBeGreaterThanOrEqual(5)
		expect(hosts).toContain('d3fi1amfgojobc.cloudfront.net')
	})

	test('resolução via CDN → host é gravado na tabela cdn_host (harvesting)', async () => {
		const { useCase, streamRepository, cdnHostRepository } = makeUseCase()
		await streamRepository.createStream(baseStream)

		await useCase.execute({ streamId: baseStream.streamId })

		const hosts = await cdnHostRepository.listHosts()
		expect(hosts).toContain(FOUND_RESOLUTION.host)
	})

	test('resolução via caminho oficial → host oficial também é gravado', async () => {
		const { useCase, streamRepository, cdnHostRepository } = makeUseCase({
			resolveOfficial: async () => FOUND_OFFICIAL_RESOLUTION,
		})
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'vod123',
			vodLookupStatus: 'linked',
		})

		await useCase.execute({ streamId: baseStream.streamId })

		const hosts = await cdnHostRepository.listHosts()
		expect(hosts).toContain(FOUND_OFFICIAL_RESOLUTION.host)
	})

	test('host já existente → não duplica', async () => {
		const { useCase, streamRepository, cdnHostRepository } = makeUseCase()
		await cdnHostRepository.recordHost(FOUND_RESOLUTION.host)
		const before = await cdnHostRepository.listHosts()
		await streamRepository.createStream(baseStream)

		await useCase.execute({ streamId: baseStream.streamId })

		const after = await cdnHostRepository.listHosts()
		expect(after.length).toBe(before.length)
	})

	test('falha ao gravar host não derruba o download (best-effort)', async () => {
		const brokenCdnHostRepository: CdnHostRepository = {
			listHosts: async () => [],
			recordHost: async () => {
				throw new Error('db indisponível')
			},
		}
		const { useCase, streamRepository, downloader } = makeUseCase({
			cdnHostRepository: brokenCdnHostRepository,
		})
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		expect(downloader.downloadCalls).toHaveLength(1)
	})
})
