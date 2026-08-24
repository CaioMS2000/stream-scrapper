import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventBus } from '../../@shared/events'
import { success } from '../../result'
import { makeTestDb } from '../../test/db'
import { FakeTwitchClient } from '../../test/twitch-client'
import { MediaStorage, StreamMetaStorage } from '../media-storage'
import { ChannelLiveEvent, ChannelOfflineEvent } from './@events'
import { ChannelMonitor } from './monitor'

function makeMonitor(
	channelsResponse: ConstructorParameters<typeof FakeTwitchClient>[1]
) {
	const { channelRepository, streamRepository } = makeTestDb()
	const bus = new EventBus()
	const twitch = new FakeTwitchClient(
		success({
			id: '1',
			displayName: 'Lexi',
			profileImageURL: '',
			stream: null,
		}),
		channelsResponse
	)
	const rootPath = mkdtempSync(join(tmpdir(), 'stream-scrapper-test-'))
	const storage = new MediaStorage({ rootPath })
	const streamMetaStorage = new StreamMetaStorage()
	const monitor = new ChannelMonitor({
		twitch,
		channelRepository,
		streamRepository,
		storage,
		streamMetaStorage,
		bus,
	})
	return {
		monitor,
		channelRepository,
		streamRepository,
		storage,
		streamMetaStorage,
		rootPath,
		bus,
	}
}

const liveStream = {
	id: '40952121362',
	title: 'live agora',
	createdAt: new Date('2026-07-01T10:00:00Z'),
}

describe('ChannelMonitor', () => {
	test('canal transiciona offline→live → persiste stream ANTES de publicar ChannelLiveEvent', async () => {
		const { monitor, channelRepository, streamRepository, bus } = makeMonitor(
			success({
				users: [
					{
						id: '1',
						login: 'lexi',
						displayName: 'Lexi',
						profileImageURL: '',
						stream: liveStream,
					},
				],
				notFoundUsers: [],
			})
		)
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const publishedEvents: ChannelLiveEvent[] = []
		bus.subscribe(ChannelLiveEvent, event => {
			publishedEvents.push(event)
		})

		await monitor.startMonitoring()
		monitor.stop()

		expect(publishedEvents).toHaveLength(1)
		expect(publishedEvents[0]?.streamId).toBe(liveStream.id)

		const stream = await streamRepository.getStream({
			streamId: liveStream.id,
		})
		expect(stream.channelName).toBe('lexi')
		expect(stream.title).toBe(liveStream.title)
	})

	test('canal persiste stream independente de autoRecord', async () => {
		const { monitor, channelRepository, streamRepository } = makeMonitor(
			success({
				users: [
					{
						id: '1',
						login: 'lexi',
						displayName: 'Lexi',
						profileImageURL: '',
						stream: liveStream,
					},
				],
				notFoundUsers: [],
			})
		)
		// autoRecord explicitamente desligado — a persistência da stream não
		// deve depender disso, só de existir o canal monitorado.
		await channelRepository.addChannel('lexi', {
			name: 'Lexi',
			autoRecord: false,
		})

		await monitor.startMonitoring()
		monitor.stop()

		const stream = await streamRepository.getStream({
			streamId: liveStream.id,
		})
		expect(stream.channelName).toBe('lexi')
	})

	test('canal transiciona pra live → meta.json mínimo existe, sem quality/status', async () => {
		const { monitor, channelRepository, storage } = makeMonitor(
			success({
				users: [
					{
						id: '1',
						login: 'lexi',
						displayName: 'Lexi',
						profileImageURL: '',
						stream: liveStream,
					},
				],
				notFoundUsers: [],
			})
		)
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		await monitor.startMonitoring()
		monitor.stop()

		const { fullPath } = storage.createStreamPath({
			channelName: 'lexi',
			streamId: liveStream.id,
			title: liveStream.title,
			startedAt: liveStream.createdAt,
		})
		const metaPath = join(fullPath, 'meta.json')
		expect(existsSync(metaPath)).toBe(true)

		const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
		expect(meta.streamId).toBe(liveStream.id)
		expect(meta.channelName).toBe('lexi')
		expect(meta.title).toBe(liveStream.title)
		expect(meta.quality).toBeUndefined()
		expect(meta.status).toBeUndefined()
	})

	test('canal sem transição (continua offline) → nem stream nem evento', async () => {
		const { monitor, channelRepository, bus } = makeMonitor(
			success({
				users: [
					{
						id: '1',
						login: 'lexi',
						displayName: 'Lexi',
						profileImageURL: '',
						stream: null,
					},
				],
				notFoundUsers: [],
			})
		)
		await channelRepository.addChannel('lexi', { name: 'Lexi' })

		const publishedLive: ChannelLiveEvent[] = []
		const publishedOffline: ChannelOfflineEvent[] = []
		bus.subscribe(ChannelLiveEvent, event => {
			publishedLive.push(event)
		})
		bus.subscribe(ChannelOfflineEvent, event => {
			publishedOffline.push(event)
		})

		await monitor.startMonitoring()
		monitor.stop()

		expect(publishedLive).toHaveLength(0)
		expect(publishedOffline).toHaveLength(0)
	})
})
