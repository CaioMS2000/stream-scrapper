import { expect, test } from 'bun:test'
import { TwitchClient } from './client.ts'
import type { HttpResponse, TwitchHttp } from './http.ts'

// Master m3u8 real (do output.txt), encurtado — a fixture do parse.
const MASTER = `#EXTM3U
#EXT-X-TWITCH-INFO:ORIGIN="s3"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4274863,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=29.993
https://cdn.example/chunked/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p30",NAME="720p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=2329723,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p30",FRAME-RATE=29.990
https://cdn.example/720p30/index-dvr.m3u8
`

// Fake HTTP: respostas canned, zero rede. É a injeção de dependência pagando.
function fakeHttp(overrides: Partial<TwitchHttp> = {}): TwitchHttp {
	return {
		postJson: async () => ({
			data: { videoPlaybackAccessToken: { value: 'v', signature: 's' } },
		}),
		getText: async (): Promise<HttpResponse> => ({
			ok: true,
			status: 200,
			body: MASTER,
		}),
		head: async () => ({ ok: false, status: 404 }),
		...overrides,
	}
}

// --- funções puras ---
test('parseManifest extrai as variantes do master', () => {
	const v = TwitchClient.parseManifest(MASTER)
	expect(v.length).toBe(2)
	expect(v[0]).toMatchObject({
		name: 'chunked',
		bandwidth: 4274863,
		resolution: '1920x1080',
		mediaPlaylistUrl: 'https://cdn.example/chunked/index-dvr.m3u8',
	})
})

test('selectQuality: best=source, específico e fallback', () => {
	const v = TwitchClient.parseManifest(MASTER)
	expect(TwitchClient.selectQuality(v, 'best').name).toBe('chunked')
	expect(TwitchClient.selectQuality(v, '720p').name).toBe('720p30')
	expect(TwitchClient.selectQuality(v, 'inexistente').name).toBe('chunked')
})

// --- resolveVodManifest (caminho 1) ---
test('resolveVodManifest: token + master → Manifest authenticated', async () => {
	const t = new TwitchClient(fakeHttp())
	const r = await t.resolveVodManifest('123')
	expect(r.ok).toBe(true)
	if (r.ok) {
		expect(r.manifest.source).toBe('authenticated')
		expect(r.manifest.variants.length).toBe(2)
	}
})

test('resolveVodManifest: sem token → not-found', async () => {
	const t = new TwitchClient(fakeHttp({ postJson: async () => ({ data: {} }) }))
	expect(await t.resolveVodManifest('123')).toEqual({
		ok: false,
		error: 'not-found',
	})
})

test('resolveVodManifest: usher 403 → forbidden', async () => {
	const t = new TwitchClient(
		fakeHttp({ getText: async () => ({ ok: false, status: 403, body: '' }) })
	)
	expect(await t.resolveVodManifest('123')).toEqual({
		ok: false,
		error: 'forbidden',
	})
})

// --- recoverVodManifest (caminho 2): valida o hash OFFLINE ---
test('recoverVodManifest: acha na CDN pela URL do hash correto', async () => {
	// valores conhecidos (do recovery.ts) → hash esperado b2fa85c40d5d5513b56a
	const expectedPath =
		'/b2fa85c40d5d5513b56a_apofigeaa_317727339494_1781869331/chunked/index-dvr.m3u8'
	const t = new TwitchClient(
		fakeHttp({
			head: async (url: string) => ({
				ok: url.includes(expectedPath),
				status: url.includes(expectedPath) ? 200 : 404,
			}),
		})
	)
	const r = await t.recoverVodManifest('apofigeaa', '317727339494', 1781869331)
	expect(r.ok).toBe(true)
	if (r.ok) {
		expect(r.manifest.source).toBe('cdn-recovery')
		expect(r.manifest.variants[0]?.mediaPlaylistUrl).toContain(expectedPath)
	}
})

test('recoverVodManifest: tudo 404 → not-on-cdn', async () => {
	const t = new TwitchClient(fakeHttp())
	expect(
		await t.recoverVodManifest('apofigeaa', '317727339494', 1781869331)
	).toEqual({ ok: false, error: 'not-on-cdn' })
})
