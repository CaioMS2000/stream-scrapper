import { defaultTwitchConfig, type TwitchConfig } from './config.ts'
import { FetchHttp, type TwitchHttp } from './http.ts'
import type { QualityVariant, ResolveResult, Twitch } from './types.ts'

// Único módulo que fala com a superfície privada da Twitch. Transforma um pedido
// num Manifest HLS normalizado — o caminho (1 vs 2) fica invisível downstream.
// Volatilidade isolada no TwitchConfig; HTTP injetado p/ testabilidade offline.
export class TwitchClient implements Twitch {
	constructor(
		private readonly http: TwitchHttp = new FetchHttp(),
		private readonly config: TwitchConfig = defaultTwitchConfig
	) {}

	// --- Caminho 1: VOD público via token dance (anônimo) ---
	async resolveVodManifest(vodId: string): Promise<ResolveResult> {
		const token = await this.getVodToken(vodId)
		if (!token) return { ok: false, error: 'not-found' }

		const url = this.usherVodUrl(vodId, token.value, token.signature)
		const res = await this.http.getText(url)
		if (!res.ok) {
			return {
				ok: false,
				error: res.status === 403 ? 'forbidden' : 'not-found',
			}
		}

		return {
			ok: true,
			manifest: {
				source: 'authenticated',
				variants: TwitchClient.parseManifest(res.body),
				authContext: { clientId: this.config.clientId },
				muted: false,
			},
		}
	}

	// --- Caminho 2: recovery por hash da CDN (sem token, sem conta) ---
	async recoverVodManifest(
		login: string,
		streamId: string,
		startedAt: number
	): Promise<ResolveResult> {
		const found = await this.probeCdn(login.toLowerCase(), streamId, startedAt)
		if (!found) return { ok: false, error: 'not-on-cdn' }

		return {
			ok: true,
			manifest: {
				source: 'cdn-recovery',
				// recovery entrega direto o media playlist source (chunked), sem master.
				variants: [
					{
						name: 'chunked',
						bandwidth: 0,
						resolution: '',
						mediaPlaylistUrl: found,
					},
				],
				authContext: { clientId: this.config.clientId },
				muted: false,
			},
		}
	}

	// --- estáticos puros (extraídos dos spikes; Modulo_Twitch §4D) ---
	static parseManifest(masterBody: string): QualityVariant[] {
		const lines = masterBody.split('\n')
		const variants: QualityVariant[] = []
		for (let i = 0; i < lines.length; i++) {
			const info = lines[i]
			if (!info?.startsWith('#EXT-X-STREAM-INF:')) continue
			const url = lines[i + 1]?.trim() ?? '' // a URL vem na linha seguinte
			if (!url) continue
			variants.push({
				name:
					info.match(/VIDEO="([^"]+)"/)?.[1] ?? `variant-${variants.length}`,
				bandwidth: Number(info.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0),
				resolution: info.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? '',
				mediaPlaylistUrl: url,
			})
		}
		return variants
	}

	static selectQuality(
		variants: QualityVariant[],
		pref: string
	): QualityVariant {
		if (variants.length === 0) throw new Error('nenhuma qualidade no manifesto')
		const best = () =>
			variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a))
		if (pref === 'best') return best()
		// match por nome de grupo ('chunked', '720p30') ou por resolução ('720p', '1080')
		const match = variants.find(
			v =>
				v.name === pref || v.name.includes(pref) || v.resolution.includes(pref)
		)
		return match ?? best()
	}

	// --- privados ---
	private async getVodToken(
		vodId: string
	): Promise<{ value: string; signature: string } | null> {
		const json = (await this.http.postJson(
			this.config.gqlUrl,
			{
				operationName: 'PlaybackAccessToken_Template',
				query: this.config.playbackQuery,
				variables: {
					isLive: false,
					login: '',
					isVod: true,
					vodID: vodId,
					playerType: 'site',
				},
			},
			{ 'Client-ID': this.config.clientId }
		)) as {
			data?: { videoPlaybackAccessToken?: { value: string; signature: string } }
		}
		return json.data?.videoPlaybackAccessToken ?? null
	}

	private usherVodUrl(vodId: string, token: string, sig: string): string {
		const p = new URLSearchParams({
			token,
			sig,
			allow_source: 'true',
			allow_audio_only: 'true',
			player: 'twitchweb',
			platform: 'web',
		})
		return `${this.config.usherVodBase}/${vodId}.m3u8?${p}`
	}

	private static cdnHash(base: string): string {
		return new Bun.CryptoHasher('sha1').update(base).digest('hex').slice(0, 20)
	}

	// Probe com janela ±2s (trackers arredondam o started_at, Modulo_Twitch §4B).
	private async probeCdn(
		login: string,
		streamId: string,
		startedAt: number
	): Promise<string | null> {
		const window = 2
		for (let off = 0; off <= window; off++) {
			const candidates =
				off === 0 ? [startedAt] : [startedAt - off, startedAt + off]
			for (const ts of candidates) {
				const base = `${login}_${streamId}_${ts}`
				const path = `/${TwitchClient.cdnHash(base)}_${base}/chunked/index-dvr.m3u8`
				for (const host of this.config.cdnHosts) {
					const url = `https://${host}${path}`
					try {
						const res = await this.http.head(url)
						if (res.ok) return url
					} catch {
						// host fora do ar / DNS — tenta o próximo
					}
				}
			}
		}
		return null
	}
}
