import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	ChannelNotFoundError,
	ChannelNotLiveError,
	StreamRecordingFailedError,
} from '../../@errors'
import {
	MediaStorage,
	StreamMetaStorage,
} from '../../infrastructure/media-storage'
import { success } from '../../result'
import { makeTestDb } from '../../test/db'
import { FakeRecorder } from '../../test/recorder'
import { FakeTwitchClient } from '../../test/twitch-client'
import { ForceRecordUseCase } from './force-record'
import { StartRecordingUseCase } from './start-recording'

function makeUseCase(
	twitchResponse: ConstructorParameters<typeof FakeTwitchClient>[0],
	recorderConfig?: ConstructorParameters<typeof FakeRecorder>[0]
) {
	const { channelRepository, streamRepository } = makeTestDb()
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const streamMetaStorage = new StreamMetaStorage()
	const recorder = new FakeRecorder(recorderConfig)
	const twitch = new FakeTwitchClient(twitchResponse)
	const startRecording = new StartRecordingUseCase({
		streamRepository,
		storage,
		streamMetaStorage,
		recorder,
	})
	const useCase = new ForceRecordUseCase({
		channelRepository,
		twitch,
		startRecording,
	})
	return { useCase, channelRepository, recorder }
}

const liveStream = {
	id: '40952121362',
	title: 'live agora',
	createdAt: new Date('2026-07-01T10:00:00Z'),
}

function twitchResponse(stream: typeof liveStream | null) {
	return success({
		id: '1',
		displayName: 'Lexi',
		profileImageURL: 'https://example.test/lexi.png',
		stream,
	})
}

describe('ForceRecordUseCase', () => {
	test('canal não cadastrado → ChannelNotFoundError', async () => {
		const { useCase } = makeUseCase(twitchResponse(null))

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotFoundError)
	})

	test('canal cadastrado mas offline → ChannelNotLiveError', async () => {
		const { useCase, channelRepository } = makeUseCase(twitchResponse(null))
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(ChannelNotLiveError)
	})

	test('canal cadastrado e ao vivo → grava com dados vindos da Twitch', async () => {
		const { useCase, channelRepository, recorder } = makeUseCase(
			twitchResponse(liveStream)
		)
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isSuccess()).toBe(true)
		expect(recorder.recordCalls).toHaveLength(1)
		expect(recorder.recordCalls[0]?.streamId).toBe(liveStream.id)
		expect(recorder.recordCalls[0]?.title).toBe(liveStream.title)
		expect(recorder.recordCalls[0]?.startedAt).toEqual(liveStream.createdAt)
	})

	test('canal ao vivo mas já gravando → StreamRecordingFailedError propagado do StartRecordingUseCase', async () => {
		const boom = new Error('gravação já ativa')
		const { useCase, channelRepository } = makeUseCase(
			twitchResponse(liveStream),
			{ throwOnRecord: boom }
		)
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const result = await useCase.execute({ channelName: 'lexi' })

		expect(result.isFailure()).toBe(true)
		expect(result.value).toBeInstanceOf(StreamRecordingFailedError)
		expect((result.value as Error).cause).toBe(boom)
	})
})
