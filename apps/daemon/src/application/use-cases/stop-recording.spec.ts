import { describe, expect, test } from 'bun:test'
import { StreamStopFailedError } from '../../@errors'
import { FakeRecorder } from '../../test/recorder'
import { StopRecordingUseCase } from './stop-recording'

function makeUseCase(
	recorderConfig?: ConstructorParameters<typeof FakeRecorder>[0]
) {
	const recorder = new FakeRecorder(recorderConfig)
	const useCase = new StopRecordingUseCase({ recorder })
	return { useCase, recorder }
}

describe('StopRecordingUseCase', () => {
	test('happy path → chama recorder.stopStream com o channelName', async () => {
		const { useCase, recorder } = makeUseCase()

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(recorder.stopCalls).toEqual(['lexi'])
	})

	test('recorder.stopStream lança → falha com StreamStopFailedError carregando cause', async () => {
		const boom = new Error('stopStream exploded')
		const { useCase } = makeUseCase({ throwOnStop: boom })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(StreamStopFailedError)
		expect((result.value as Error).cause).toBe(boom)
	})
})
