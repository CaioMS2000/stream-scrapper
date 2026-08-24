import { describe, expect, test } from 'bun:test'
import {
	ChannelNotFoundError,
	ChannelNotRecordingError,
	StreamStopFailedError,
} from '../../@errors'
import { makeTestDb } from '../../test/db'
import { FakeRecorder } from '../../test/recorder'
import { ForceStopUseCase } from './force-stop'
import { StopRecordingUseCase } from './stop-recording'

function makeUseCase(
	recorderConfig?: ConstructorParameters<typeof FakeRecorder>[0]
) {
	const { channelRepository } = makeTestDb()
	const recorder = new FakeRecorder(recorderConfig)
	const stopRecording = new StopRecordingUseCase({ recorder })
	const useCase = new ForceStopUseCase({
		channelRepository,
		recorder,
		stopRecording,
	})
	return { useCase, channelRepository, recorder }
}

describe('ForceStopUseCase', () => {
	test('canal não cadastrado → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal cadastrado mas sem gravação ativa → ChannelNotRecordingError', async () => {
		const { useCase, channelRepository } = makeUseCase()
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotRecordingError)
	})

	test('canal cadastrado e gravando → chama recorder.stopStream', async () => {
		const { useCase, channelRepository, recorder } = makeUseCase()
		await channelRepository.addChannel('lexi', { name: 'Lexi' })
		recorder.recording.add('lexi')

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(recorder.stopCalls).toEqual(['lexi'])
	})

	test('recorder.stopStream lança → StreamStopFailedError propagado do StopRecordingUseCase', async () => {
		const boom = new Error('stopStream exploded')
		const { useCase, channelRepository, recorder } = makeUseCase({
			throwOnStop: boom,
		})
		await channelRepository.addChannel('lexi', { name: 'Lexi' })
		recorder.recording.add('lexi')

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(StreamStopFailedError)
		expect((result.value as Error).cause).toBe(boom)
	})
})
