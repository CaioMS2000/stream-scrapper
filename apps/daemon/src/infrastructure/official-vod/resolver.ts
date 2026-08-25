import type { VideoQuality } from '@/application/models/types'
import { parseSegments } from '../hls'
import { type TwitchClient, TwitchClientImpl } from '../twitch/client'
import { selectVariant } from './quality'
import { parseMasterPlaylist } from './usher'

// Assinatura mínima, não `typeof fetch` inteiro — mesma justificativa de
// infrastructure/cdn-recovery/resolver.ts.
type FetchLike = (url: string) => Promise<Response>

type ResolveViaOfficialParams = {
	vodId: string
	qualityPref: VideoQuality
}

type ResolveViaOfficialOptions = {
	twitchClient?: TwitchClient
	fetchImpl?: FetchLike
}

// Mesmo shape estrutural de CdnResolution (infrastructure/cdn-recovery) —
// propositalmente compatível pra uma futura orquestração (CAI-76) tratar
// os dois resolvers de forma uniforme, sem duplicar o tipo por
// antecipação agora.
export type OfficialVodResolution = {
	host: string
	baseUrl: string
	segments: string[]
}

const USHER_URL = 'https://usher.ttvnw.net/vod'

// Caminho C do design doc (docs/design/002-download-de-vods.md): dado um
// vodId já resolvido (caminho A), busca o token de reprodução oficial e
// resolve a URL real do VOD respeitando `qualityPref` — algo que o
// caminho B (CDN) não consegue (só alcança "chunked"/source). Validado
// ponta a ponta contra a Twitch real, ver apps/daemon/spikes/FINDINGS.md
// (seção 2).
//
// Tolerante a falha, igual ao resolveViaCdn: qualquer etapa que não der
// certo (token forbidden/não encontrado, usher fora do ar, variante sem
// segments) retorna null em vez de lançar — quem chama decide o que fazer
// (orquestração futura, CAI-76).
export async function resolveViaOfficial(
	{ vodId, qualityPref }: ResolveViaOfficialParams,
	options: ResolveViaOfficialOptions = {}
): Promise<OfficialVodResolution | null> {
	const twitchClient = options.twitchClient ?? new TwitchClientImpl()
	const fetchImpl = options.fetchImpl ?? fetch

	const tokenResult = await twitchClient.getVodPlaybackAccessToken(vodId)
	if (tokenResult.isFailure() || tokenResult.value.forbidden) {
		return null
	}
	const { value, signature } = tokenResult.value

	const qs = new URLSearchParams({
		nauth: value,
		nauthsig: signature,
		allow_source: 'true',
		allow_audio_only: 'true',
		player: 'twitchweb',
	})

	let masterResponse: Response
	try {
		masterResponse = await fetchImpl(`${USHER_URL}/${vodId}?${qs}`)
	} catch {
		return null
	}
	if (!masterResponse.ok) return null

	const variants = parseMasterPlaylist(await masterResponse.text())
	const variant = selectVariant(variants, qualityPref)
	if (!variant) return null

	let mediaResponse: Response
	try {
		mediaResponse = await fetchImpl(variant.url)
	} catch {
		return null
	}
	if (!mediaResponse.ok) return null

	const segments = parseSegments(await mediaResponse.text())
	if (segments.length === 0) return null

	const baseUrl = variant.url.slice(0, variant.url.lastIndexOf('/'))
	return { host: new URL(variant.url).host, baseUrl, segments }
}
