import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	ChannelAlreadyRegisteredError,
	ChannelNotFoundError,
} from '../../@errors'
import { MediaStorage } from '../../infrastructure/media-storage'
import { failure, success } from '../../result'
import { makeTestDb } from '../../test/db'
import {
	FakeTwitchClient,
	type GetChannelReturn,
} from '../../test/twitch-client'
import { AddChannelUseCase } from './add-channel'

function makeUseCase(response: GetChannelReturn) {
	const { channelRepository } = makeTestDb()
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const twitch = new FakeTwitchClient(response)
	const useCase = new AddChannelUseCase({ twitch, channelRepository, storage })
	return { useCase, channelRepository, storage, rootPath }
}

describe('AddChannelUseCase', () => {
	test('twitch retorna not found → propaga ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase(
			failure(new ChannelNotFoundError('doesnotexist'))
		)

		const result = await useCase.execute({ channelName: 'doesnotexist' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe e store vazio → persiste e retorna sucesso', async () => {
		const { useCase, channelRepository, rootPath } = makeUseCase(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: 'https://example.test/lexi.png',
				stream: null,
			})
		)

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual({ username: 'lexi', recording: false })

		// efeitos colaterais observáveis
		const persisted = await channelRepository.findChannel('lexi')
		expect(persisted?.username).toBe('lexi')
		expect(persisted?.displayName).toBe('Lexi')
		expect(existsSync(join(rootPath, 'lexi'))).toBe(true)
	})

	test('canal já registrado → falha sem duplicar', async () => {
		const { useCase, channelRepository } = makeUseCase(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: 'https://example.test/lexi.png',
				stream: null,
			})
		)

		await useCase.execute({ channelName: 'lexi' }) // primeiro cadastro
		const result = await useCase.execute({ channelName: 'lexi' }) // duplicado

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelAlreadyRegisteredError)

		// continua com apenas um registro
		const persisted = await channelRepository.findChannel('lexi')
		expect(persisted).not.toBeNull()
	})
})
