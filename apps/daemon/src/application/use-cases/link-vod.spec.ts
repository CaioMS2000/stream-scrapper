import { describe, expect, test } from 'bun:test'
import { ChannelNotFoundError } from '../../@errors'
import { failure, success } from '../../result'
import { makeTestDb } from '../../test/db'
import { FakeTwitchClient } from '../../test/twitch-client'
import { LinkVodUseCase } from './link-vod'

function makeUseCase(
	videosResponse: ConstructorParameters<typeof FakeTwitchClient>[2]
) {
	const { streamRepository } = makeTestDb()
	const twitch = new FakeTwitchClient(
		success({
			id: '1',
			displayName: 'Lexi',
			profileImageURL: '',
			stream: null,
		}),
		undefined,
		videosResponse
	)
	const useCase = new LinkVodUseCase({ streamRepository, twitchClient: twitch })
	return { useCase, streamRepository }
}

const baseStream = {
	channelName: 'lexi',
	streamId: '40952121362',
	title: 'first stream',
	startedAt: new Date('2026-07-01T10:00:00Z'),
}

describe('LinkVodUseCase', () => {
	test('vídeo dentro da tolerância → linked, vodId gravado', async () => {
		const { useCase, streamRepository } = makeUseCase(
			success([
				{
					id: 'vod-123',
					// 4 minutos de diferença — dentro da tolerância de 5min.
					createdAt: new Date('2026-07-01T10:04:00Z'),
					lengthSeconds: 3600,
				},
			])
		)
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		const stream = await streamRepository.getStream({
			streamId: baseStream.streamId,
		})
		expect(stream.vodLookupStatus).toBe('linked')
		expect(stream.vodId).toBe('vod-123')
	})

	test('sem match dentro da tolerância → continua pending, sem write', async () => {
		// startedAt recente (não os 54+ dias atrás do baseStream fixo) — senão
		// essa stream já estaria fora da janela de 48h e o teste testaria o
		// caso errado (unavailable em vez de pending).
		const recentStream = {
			...baseStream,
			startedAt: new Date(Date.now() - 60_000),
		}
		const { useCase, streamRepository } = makeUseCase(
			success([
				{
					id: 'vod-999',
					// 20 minutos de diferença — fora da tolerância de 5min.
					createdAt: new Date(recentStream.startedAt.getTime() + 20 * 60_000),
					lengthSeconds: 3600,
				},
			])
		)
		await streamRepository.createStream(recentStream)

		const result = await useCase.execute({ streamId: recentStream.streamId })

		expect(result.isSuccess()).toBe(true)
		const stream = await streamRepository.getStream({
			streamId: recentStream.streamId,
		})
		expect(stream.vodLookupStatus).toBe('pending')
		expect(stream.vodId).toBeNull()
	})

	test('sem match e mais de 48h desde o início → unavailable', async () => {
		const { useCase, streamRepository } = makeUseCase(success([]))
		const oldStream = {
			...baseStream,
			startedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
		}
		await streamRepository.createStream(oldStream)

		const result = await useCase.execute({ streamId: oldStream.streamId })

		expect(result.isSuccess()).toBe(true)
		const stream = await streamRepository.getStream({
			streamId: oldStream.streamId,
		})
		expect(stream.vodLookupStatus).toBe('unavailable')
		expect(stream.vodId).toBeNull()
	})

	test('canal não encontrado na Twitch → failure, continua pending', async () => {
		const { useCase, streamRepository } = makeUseCase(
			failure(new ChannelNotFoundError('lexi'))
		)
		await streamRepository.createStream(baseStream)

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
		const stream = await streamRepository.getStream({
			streamId: baseStream.streamId,
		})
		expect(stream.vodLookupStatus).toBe('pending')
	})

	test('stream que já não está pending → no-op idempotente', async () => {
		const { useCase, streamRepository } = makeUseCase(
			success([
				{
					id: 'vod-should-not-be-used',
					createdAt: baseStream.startedAt,
					lengthSeconds: 100,
				},
			])
		)
		await streamRepository.createStream(baseStream)
		await streamRepository.updateVodLookup({
			streamId: baseStream.streamId,
			vodId: 'already-linked',
			vodLookupStatus: 'linked',
		})

		const result = await useCase.execute({ streamId: baseStream.streamId })

		expect(result.isSuccess()).toBe(true)
		const stream = await streamRepository.getStream({
			streamId: baseStream.streamId,
		})
		expect(stream.vodId).toBe('already-linked')
	})
})
