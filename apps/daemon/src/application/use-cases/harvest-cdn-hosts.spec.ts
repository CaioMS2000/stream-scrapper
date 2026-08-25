import { describe, expect, test } from 'bun:test'
import { ChannelNotFoundError } from '../../@errors'
import { DrizzleCdnHostRepository } from '../../infrastructure/database/repositories'
import type { OfficialVodResolution } from '../../infrastructure/official-vod'
import { failure, success } from '../../result'
import { makeTestDb } from '../../test/db'
import { FakeTwitchClient } from '../../test/twitch-client'
import type { ResolveOfficialFn } from './download-vod'
import { HarvestCdnHostsUseCase } from './harvest-cdn-hosts'

const FOUND_OFFICIAL_RESOLUTION: OfficialVodResolution = {
	host: 'd3fi1amfgojobc.cloudfront.net',
	baseUrl: 'https://d3fi1amfgojobc.cloudfront.net/vod123/chunked',
	segments: ['0.ts', '1.ts'],
}

function makeUseCase(options?: {
	videosResponse?: ConstructorParameters<typeof FakeTwitchClient>[2]
	resolveOfficial?: ResolveOfficialFn
}) {
	const { db } = makeTestDb()
	const cdnHostRepository = new DrizzleCdnHostRepository({ drizzle: db })
	const twitch = new FakeTwitchClient(
		success({
			id: '1',
			displayName: 'Lexi',
			profileImageURL: '',
			stream: null,
		}),
		undefined,
		options?.videosResponse
	)
	const resolveOfficial =
		options?.resolveOfficial ?? (async () => FOUND_OFFICIAL_RESOLUTION)

	const useCase = new HarvestCdnHostsUseCase({
		twitchClient: twitch,
		cdnHostRepository,
		resolveOfficial,
	})

	return { useCase, cdnHostRepository }
}

describe('HarvestCdnHostsUseCase', () => {
	test('canal com VOD → host resolvido é gravado', async () => {
		const { useCase, cdnHostRepository } = makeUseCase({
			videosResponse: success([
				{ id: 'vod-123', createdAt: new Date(), lengthSeconds: 3600 },
			]),
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		const hosts = await cdnHostRepository.listHosts()
		expect(hosts).toContain(FOUND_OFFICIAL_RESOLUTION.host)
	})

	test('canal sem nenhuma VOD → no-op, nenhum host gravado', async () => {
		let resolveCalled = false
		const { useCase, cdnHostRepository } = makeUseCase({
			videosResponse: success([]),
			resolveOfficial: async () => {
				resolveCalled = true
				return FOUND_OFFICIAL_RESOLUTION
			},
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(resolveCalled).toBe(false)
		expect(await cdnHostRepository.listHosts()).toHaveLength(0)
	})

	test('canal não encontrado na Twitch → failure', async () => {
		const { useCase } = makeUseCase({
			videosResponse: failure(new ChannelNotFoundError('lexi')),
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('resolveOfficial retorna null (sub-only/deletada) → no-op, sem erro', async () => {
		const { useCase, cdnHostRepository } = makeUseCase({
			videosResponse: success([
				{ id: 'vod-123', createdAt: new Date(), lengthSeconds: 3600 },
			]),
			resolveOfficial: async () => null,
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(await cdnHostRepository.listHosts()).toHaveLength(0)
	})

	test('falha ao gravar host → failure (diferente do best-effort de DownloadVodUseCase)', async () => {
		const twitch = new FakeTwitchClient(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: '',
				stream: null,
			}),
			undefined,
			success([{ id: 'vod-123', createdAt: new Date(), lengthSeconds: 3600 }])
		)
		const useCase = new HarvestCdnHostsUseCase({
			twitchClient: twitch,
			cdnHostRepository: {
				listHosts: async () => [],
				recordHost: async () => {
					throw new Error('db indisponível')
				},
			},
			resolveOfficial: async () => FOUND_OFFICIAL_RESOLUTION,
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
	})
})
