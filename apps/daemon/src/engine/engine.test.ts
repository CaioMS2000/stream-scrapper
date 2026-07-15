import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ChannelAlreadyRegisteredError, ChannelNotFoundError } from '../@errors'
import { failure, success } from '../result'
import { makeEngine } from '../test/engine'

describe('Engine.addChannel', () => {
	test('twitch retorna not found → propaga ChannelNotFoundError', async () => {
		const { engine } = makeEngine(
			failure(new ChannelNotFoundError('doesnotexist'))
		)

		const result = await engine.addChannel('doesnotexist')

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal existe e store vazio → persiste e retorna sucesso', async () => {
		const { engine, channelRepository, rootPath } = makeEngine(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: 'https://example.test/lexi.png',
				stream: null,
			})
		)

		const result = await engine.addChannel('lexi')

		expect(result.isSuccess()).toBe(true)
		expect(result.value).toEqual({ username: 'lexi', recording: false })

		// efeitos colaterais observáveis
		const persisted = await channelRepository.findChannel('lexi')
		expect(persisted?.username).toBe('lexi')
		expect(persisted?.displayName).toBe('Lexi')
		expect(existsSync(join(rootPath, 'lexi'))).toBe(true)
	})

	test('canal já registrado → falha sem duplicar', async () => {
		const { engine, channelRepository } = makeEngine(
			success({
				id: '1',
				displayName: 'Lexi',
				profileImageURL: 'https://example.test/lexi.png',
				stream: null,
			})
		)

		await engine.addChannel('lexi') // primeiro cadastro
		const result = await engine.addChannel('lexi') // duplicado

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelAlreadyRegisteredError)

		// continua com apenas um registro
		const persisted = await channelRepository.findChannel('lexi')
		expect(persisted).not.toBeNull()
	})
})
