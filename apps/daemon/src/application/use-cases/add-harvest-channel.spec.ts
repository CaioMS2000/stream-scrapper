import { describe, expect, test } from 'bun:test'
import { DrizzleHarvestChannelRepository } from '../../infrastructure/database/repositories'
import { makeTestDb } from '../../test/db'
import { AddHarvestChannelUseCase } from './add-harvest-channel'

function makeUseCase() {
	const { db } = makeTestDb()
	const harvestChannelRepository = new DrizzleHarvestChannelRepository({
		drizzle: db,
	})
	const useCase = new AddHarvestChannelUseCase({ harvestChannelRepository })
	return { useCase, harvestChannelRepository }
}

describe('AddHarvestChannelUseCase', () => {
	test('canal novo → gravado na tabela', async () => {
		const { useCase, harvestChannelRepository } = makeUseCase()

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(await harvestChannelRepository.listChannels()).toEqual(['lexi'])
	})

	test('canal repetido → idempotente, não duplica nem falha', async () => {
		const { useCase, harvestChannelRepository } = makeUseCase()

		await useCase.execute({ channelName: 'lexi' })
		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(await harvestChannelRepository.listChannels()).toEqual(['lexi'])
	})
})
