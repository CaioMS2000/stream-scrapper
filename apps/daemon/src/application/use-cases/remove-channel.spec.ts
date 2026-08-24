import { describe, expect, test } from 'bun:test'
import {
	ChannelNotFoundError,
	ChannelRecordingInProgressError,
} from '../../@errors'
import { makeTestDb } from '../../test/db'
import { FakeRecorder } from '../../test/recorder'
import { RemoveChannelUseCase } from './remove-channel'

function makeUseCase() {
	const { channelRepository } = makeTestDb()
	const recorder = new FakeRecorder()
	const useCase = new RemoveChannelUseCase({ channelRepository, recorder })
	return { useCase, channelRepository, recorder }
}

describe('RemoveChannelUseCase', () => {
	test('canal não existe → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'ghost' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe e não está gravando → remove da DB', async () => {
		const { useCase, channelRepository } = makeUseCase()

		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(await channelRepository.findChannel('lexi')).toBeNull()
	})

	test('canal existe e está gravando → ChannelRecordingInProgressError, canal permanece', async () => {
		const { useCase, channelRepository, recorder } = makeUseCase()

		await channelRepository.addChannel('lexi', { name: 'Lexi' })
		recorder.recording.add('lexi')

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelRecordingInProgressError)

		// Pós-condição: o bloqueio realmente impediu o delete.
		expect(await channelRepository.findChannel('lexi')).not.toBeNull()
	})
})
