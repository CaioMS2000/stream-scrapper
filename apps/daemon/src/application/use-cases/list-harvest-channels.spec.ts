import { describe, expect, test } from 'bun:test'
import { DrizzleHarvestChannelRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { ListHarvestChannelsUseCase } from './list-harvest-channels'

function makeUseCase() {
	const { db } = makeTestDb()
	const harvestChannelRepository = new DrizzleHarvestChannelRepository({
		drizzle: db,
	})
	const useCase = new ListHarvestChannelsUseCase({ harvestChannelRepository })
	return { useCase, harvestChannelRepository }
}

describe('ListHarvestChannelsUseCase', () => {
	test('nenhum canal cadastrado → lista vazia', async () => {
		const { useCase } = makeUseCase()

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual([])
	})

	test('múltiplos canais → ordenados alfabeticamente', async () => {
		const { useCase, harvestChannelRepository } = makeUseCase()
		await harvestChannelRepository.addChannel('zeta')
		await harvestChannelRepository.addChannel('lexi')

		const result = await useCase.execute()

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual(['lexi', 'zeta'])
	})
})
