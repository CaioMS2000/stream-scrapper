import { describe, expect, test } from 'bun:test'
import { ChannelNotFoundError } from '../../@errors'
import { makeTestDb } from '../../test/db'
import { DisableAutoRecordingUseCase } from './disable-auto-recording'

function makeUseCase() {
	const { channelRepository } = makeTestDb()
	const useCase = new DisableAutoRecordingUseCase({ channelRepository })
	return { useCase, channelRepository }
}

describe('DisableAutoRecordingUseCase', () => {
	test('canal não existe → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'ghost' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe com autoRecord=true → grava autoRecord=false na DB', async () => {
		const { useCase, channelRepository } = makeUseCase()

		await channelRepository.addChannel('lexi', {
			name: 'Lexi',
			autoRecord: true,
		})
		const before = await channelRepository.findChannel('lexi')
		expect(before?.autoRecord).toBe(true)

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)

		const after = await channelRepository.findChannel('lexi')
		expect(after?.autoRecord).toBe(false)
	})
})
