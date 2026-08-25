import { describe, expect, test } from 'bun:test'
import { VodPlaybackTokenNotFoundError } from '@/@errors'
import { failure, success } from '@/result'
import { FakeTwitchClient } from '../../test/twitch-client'
import { resolveViaOfficial } from './resolver'

const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4026386,VIDEO="chunked"
https://d3fi1amfgojobc.cloudfront.net/vod123/chunked/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="360p30",NAME="360p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=709650,VIDEO="360p30"
https://d3fi1amfgojobc.cloudfront.net/vod123/360p30/index-dvr.m3u8
`

const MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.000,
0.ts
#EXTINF:10.000,
1.ts
#EXT-X-ENDLIST
`

function makeFakeClient(
	playbackTokenResponse: ConstructorParameters<typeof FakeTwitchClient>[3]
) {
	return new FakeTwitchClient(
		success({
			id: '1',
			displayName: 'Lexi',
			profileImageURL: '',
			stream: null,
		}),
		undefined,
		undefined,
		playbackTokenResponse
	)
}

describe('resolveViaOfficial', () => {
	test('resolve ponta a ponta: token válido + qualidade disponível', async () => {
		const twitchClient = makeFakeClient(
			success({ value: 'tok', signature: 'sig', forbidden: false })
		)
		const calls: string[] = []
		const fetchImpl = async (url: string) => {
			calls.push(url)
			if (url.includes('usher.ttvnw.net')) {
				return new Response(MASTER_PLAYLIST, { status: 200 })
			}
			return new Response(MEDIA_PLAYLIST, { status: 200 })
		}

		const result = await resolveViaOfficial(
			{ vodId: 'vod123', qualityPref: 'source' },
			{ twitchClient, fetchImpl }
		)

		expect(result).toEqual({
			host: 'd3fi1amfgojobc.cloudfront.net',
			baseUrl: 'https://d3fi1amfgojobc.cloudfront.net/vod123/chunked',
			segments: ['0.ts', '1.ts'],
		})
		expect(calls[0]).toContain('nauth=tok')
		expect(calls[0]).toContain('nauthsig=sig')
	})

	test('token forbidden (VOD sub-only) → null, nem tenta o usher', async () => {
		const twitchClient = makeFakeClient(
			success({ value: 'tok', signature: 'sig', forbidden: true })
		)
		let usherCalled = false
		const fetchImpl = async () => {
			usherCalled = true
			return new Response('', { status: 200 })
		}

		const result = await resolveViaOfficial(
			{ vodId: 'vod123', qualityPref: 'source' },
			{ twitchClient, fetchImpl }
		)

		expect(result).toBeNull()
		expect(usherCalled).toBe(false)
	})

	test('token não encontrado (vodId inexistente) → null', async () => {
		const twitchClient = makeFakeClient(
			failure(new VodPlaybackTokenNotFoundError('vod123'))
		)

		const result = await resolveViaOfficial(
			{ vodId: 'vod123', qualityPref: 'source' },
			{ twitchClient, fetchImpl: async () => new Response('', { status: 200 }) }
		)

		expect(result).toBeNull()
	})

	test('usher fora do ar (HTTP erro) → null', async () => {
		const twitchClient = makeFakeClient(
			success({ value: 'tok', signature: 'sig', forbidden: false })
		)

		const result = await resolveViaOfficial(
			{ vodId: 'vod123', qualityPref: 'source' },
			{ twitchClient, fetchImpl: async () => new Response('', { status: 503 }) }
		)

		expect(result).toBeNull()
	})

	test('qualidade pedida indisponível → cai pro fallback (360p, já que source só tem 1080p/360p aqui)', async () => {
		const twitchClient = makeFakeClient(
			success({ value: 'tok', signature: 'sig', forbidden: false })
		)
		const fetchImpl = async (url: string) => {
			if (url.includes('usher.ttvnw.net')) {
				return new Response(MASTER_PLAYLIST, { status: 200 })
			}
			return new Response(MEDIA_PLAYLIST, { status: 200 })
		}

		const result = await resolveViaOfficial(
			{ vodId: 'vod123', qualityPref: '720p' },
			{ twitchClient, fetchImpl }
		)

		expect(result?.baseUrl).toBe(
			'https://d3fi1amfgojobc.cloudfront.net/vod123/360p30'
		)
	})
})
