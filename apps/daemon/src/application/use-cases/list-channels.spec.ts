import { describe, expect, test } from 'bun:test'
import { makeTestDb } from '../../test/db'
import { FakeRecorder } from '../../test/recorder'
import { ListChannelsUseCase } from './list-channels'

function makeUseCase() {
	const { channelRepository } = makeTestDb()
	const recorder = new FakeRecorder()
	const useCase = new ListChannelsUseCase({ channelRepository, recorder })
	return { useCase, channelRepository, recorder }
}

describe('ListChannelsUseCase', () => {
	test('nenhum canal cadastrado → lista vazia', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual([])
	})

	test('múltiplos canais → resume status de cada um, ordenado por username', async () => {
		const { useCase, channelRepository, recorder } = makeUseCase()

		await channelRepository.addChannel('zeta', { name: 'Zeta' })
		await channelRepository.addChannel('lexi', {
			name: 'Lexi',
			autoRecord: true,
		})
		recorder.recording.add('lexi')

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual([
			{
				username: 'lexi',
				displayName: 'Lexi',
				isLive: false,
				isRecording: true,
				autoRecord: true,
			},
			{
				username: 'zeta',
				displayName: 'Zeta',
				isLive: false,
				isRecording: false,
				autoRecord: false,
			},
		])
	})
})
