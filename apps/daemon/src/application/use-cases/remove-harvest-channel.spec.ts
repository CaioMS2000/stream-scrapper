import { describe, expect, test } from 'bun:test'
import { HarvestChannelNotFoundError } from '../../@errors'
import { DrizzleHarvestChannelRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { RemoveHarvestChannelUseCase } from './remove-harvest-channel'

function makeUseCase() {
	const { db } = makeTestDb()
	const harvestChannelRepository = new DrizzleHarvestChannelRepository({
		drizzle: db,
	})
	const useCase = new RemoveHarvestChannelUseCase({ harvestChannelRepository })
	return { useCase, harvestChannelRepository }
}

describe('RemoveHarvestChannelUseCase', () => {
	test('canal não existe → HarvestChannelNotFoundError', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute({ channelName: 'ghost' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(HarvestChannelNotFoundError)
	})

	test('canal existe → removido da tabela', async () => {
		const { useCase, harvestChannelRepository } = makeUseCase()
		await harvestChannelRepository.addChannel('lexi')

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(await harvestChannelRepository.listChannels()).toEqual([])
	})
})
