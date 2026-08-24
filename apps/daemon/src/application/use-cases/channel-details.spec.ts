import { describe, expect, test } from 'bun:test'
import { ChannelNotFoundError } from '../../@errors'
import { DrizzleRecordingRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { ChannelDetailsUseCase } from './channel-details'

function makeUseCase() {
	const { db, channelRepository, streamRepository } = makeTestDb()
	const recordingRepository = new DrizzleRecordingRepository({ drizzle: db })
	const useCase = new ChannelDetailsUseCase({
		channelRepository,
		streamRepository,
		recordingRepository,
	})
	return { useCase, channelRepository, streamRepository, recordingRepository }
}

describe('ChannelDetailsUseCase', () => {
	test('canal não existe → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe sem streams → streams vazio', async () => {
		const { useCase, channelRepository } = makeUseCase()
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		if (result.isSuccess()) {
			expect(result.value.username).toBe('lexi')
			expect(result.value.streams).toEqual([])
		}
	})

	test('canal com streams → marcador de gravação correto, ordenado por startedAt desc', async () => {
		const {
			useCase,
			channelRepository,
			streamRepository,
			recordingRepository,
		} = makeUseCase()
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		// stream mais antiga, sem gravação
		await streamRepository.findOrCreateStream({
			streamId: 'old-stream',
			channelName: 'lexi',
			title: 'primeira live',
			startedAt: new Date('2026-07-01T10:00:00Z'),
		})

		// stream mais recente, com gravação finalizada
		await streamRepository.findOrCreateStream({
			streamId: 'new-stream',
			channelName: 'lexi',
			title: 'segunda live',
			startedAt: new Date('2026-08-01T10:00:00Z'),
		})
		await recordingRepository.createRecording({
			streamId: 'new-stream',
			startedAt: new Date('2026-08-01T10:00:00Z'),
			status: 'finished',
			quality: 'source',
			storagePath: '/data/lexi/2026-08-01/segunda-live(new-stream)',
			bytes: 123456,
		})

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		if (!result.isSuccess()) return

		expect(result.value.streams).toHaveLength(2)

		// ordenado por startedAt desc — a mais recente (com gravação) primeiro
		const [first, second] = result.value.streams
		expect(first?.streamId).toBe('new-stream')
		expect(first?.recording?.status).toBe('finished')
		expect(first?.recording?.bytes).toBe(123456)

		expect(second?.streamId).toBe('old-stream')
		expect(second?.recording).toBeNull()
	})
})
