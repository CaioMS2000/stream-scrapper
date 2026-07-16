import { describe, expect, test } from 'bun:test'
import { ChannelNotFoundError } from '../@errors'
import { makeTestDb } from '../test/db'
import { EnableAutoRecordingUseCase } from './enable-auto-recording'

function makeUseCase() {
	const { channelRepository } = makeTestDb()
	const useCase = new EnableAutoRecordingUseCase({ channelRepository })
	return { useCase, channelRepository }
}

describe('EnableAutoRecordingUseCase', () => {
	test('canal não existe → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'ghost' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe → grava autoRecord=true na DB', async () => {
		const { useCase, channelRepository } = makeUseCase()

		// Pré-condição: canal existe e autoRecord começa false (default do schema).
		await channelRepository.addChannel('lexi', { name: 'Lexi' })
		const before = await channelRepository.findChannel('lexi')
		expect(before?.autoRecord).toBe(false)

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)

		// Pós-condição: autoRecord foi flipado pra true. Prova que o
		// updateChannel do use case executou — a Engine antiga NÃO fazia isso.
		const after = await channelRepository.findChannel('lexi')
		expect(after?.autoRecord).toBe(true)
	})
})
