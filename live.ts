// live.ts — descartável. O spike do caminho 3 (gravação ao vivo).
// Prova o lado difícil: playlist ROLANTE + token que expira no meio.
//
// Diferenças vs index.ts (VOD), ver Modulo_Twitch §4A:
//   - gql: isLive:true + login (lê streamPlaybackAccessToken, não videoPlaybackAccessToken)
//   - usher: /api/channel/hls/{login}.m3u8  (não /vod/{id})
//   - manifesto SEM #EXT-X-ENDLIST → o ffmpeg não fecha sozinho; roda até a live
//     acabar OU o token vencer e ele morrer (é o porquê do recorder existir).
//
// Uso:  bun live.ts <username> [qualidade]
//       username  = login do canal (só funciona se estiver AO VIVO agora)
//       qualidade = 'best' (padrão), 'chunked' (=source), '720p60', '720p'…
//
// Grava em .ts de propósito (não .mp4): TS é robusto a truncamento, então mesmo
// se cair no meio (crash/kill/queda de luz) o arquivo ainda toca. É a lição do
// Modulo_Recorder §7 — remuxa pra .mp4 depois, se quiser.
//
// Usa o ffmpeg de ./bin com fallback pro PATH.

import { join } from 'node:path'

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // web client público (Referencia_Tecnica §3)

const LOCAL_FFMPEG = join(import.meta.dir, 'bin', 'ffmpeg')
const FFMPEG = (await Bun.file(LOCAL_FFMPEG).exists()) ? LOCAL_FFMPEG : 'ffmpeg'

const login = process.argv[2]?.toLowerCase()
if (!login) {
	console.error('uso: bun live.ts <username> [qualidade]')
	process.exit(1)
}

// 1) Token dance LIVE — mesma query do VOD, mas com isLive:true + login.
// A resposta vem em streamPlaybackAccessToken (não videoPlaybackAccessToken).
async function getLiveToken(
	channel: string
): Promise<{ value: string; signature: string }> {
	const body = {
		operationName: 'PlaybackAccessToken_Template',
		query:
			'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {' +
			'  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename }' +
			'  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }' +
			'}',
		variables: {
			isLive: true,
			login: channel,
			isVod: false,
			vodID: '',
			playerType: 'site',
		},
	}

	const res = await fetch('https://gql.twitch.tv/gql', {
		method: 'POST',
		headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})

	if (!res.ok)
		throw new Error(`gql falhou: HTTP ${res.status} — ${await res.text()}`)
	const json = await res.json()
	const tok = json?.data?.streamPlaybackAccessToken
	if (!tok)
		throw new Error(
			`sem token de live — o canal "${channel}" provavelmente está offline`
		)
	return { value: tok.value, signature: tok.signature }
}

// 2) usher LIVE → master m3u8 (endpoint de canal, não de vod).
function usherLiveUrl(channel: string, token: string, sig: string): string {
	const p = new URLSearchParams({
		token,
		sig,
		allow_source: 'true',
		allow_audio_only: 'true',
		fast_bread: 'true', // baixa latência (segmentos parciais) — típico de live
		player: 'twitchweb',
		platform: 'web',
	})
	return `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${p}`
}

// 3) Parse + seleção de qualidade — idêntico ao index.ts (vira o Modulo_Twitch §4D).
// Duplicado de propósito: cada spike é auto-contido. A DRY vem quando extrair o módulo.
type Variant = {
	name: string
	bandwidth: number
	resolution: string
	url: string
}

function parseManifest(masterBody: string): Variant[] {
	const lines = masterBody.split('\n')
	const variants: Variant[] = []
	for (let i = 0; i < lines.length; i++) {
		const info = lines[i]
		if (!info?.startsWith('#EXT-X-STREAM-INF:')) continue
		const url = lines[i + 1]?.trim() ?? ''
		if (!url) continue
		variants.push({
			name: info.match(/VIDEO="([^"]+)"/)?.[1] ?? `variant-${variants.length}`,
			bandwidth: Number(info.match(/BANDWIDTH=(\d+)/)?.[1] ?? 0),
			resolution: info.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? '',
			url,
		})
	}
	return variants
}

function selectQuality(variants: Variant[], pref: string): Variant {
	if (variants.length === 0) throw new Error('nenhuma qualidade no manifesto')
	const best = () =>
		variants.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a))
	if (pref === 'best') return best()
	const match = variants.find(
		v => v.name === pref || v.name.includes(pref) || v.resolution.includes(pref)
	)
	if (match) return match
	console.warn(`aviso: qualidade "${pref}" não achada — caindo pro best`)
	return best()
}

const { value, signature } = await getLiveToken(login)
console.log(`✓ token de live obtido (${login} está no ar)`)

const master = usherLiveUrl(login, value, signature)
const mres = await fetch(master)
if (!mres.ok)
	throw new Error(`usher falhou: HTTP ${mres.status} — ${await mres.text()}`)
const masterBody = await mres.text()

const variants = parseManifest(masterBody)
console.log('✓ qualidades disponíveis:')
for (const v of variants) {
	const mbps = (v.bandwidth / 1e6).toFixed(2)
	console.log(
		`   ${v.name.padEnd(12)} ${(v.resolution || 'audio').padEnd(9)} ${mbps} Mbps`
	)
}

const qualityPref = process.argv[3] ?? 'best'
const chosen = selectQuality(variants, qualityPref)
console.log(
	`→ escolhida: ${chosen.name} (${chosen.resolution || 'audio-only'})`
)

// 4) ffmpeg no media playlist rolante → grava .ts até a live acabar / token vencer.
// Sem -bsf:a aac_adtstoasc aqui: isso é pra .mp4; em .ts o AAC (ADTS) vai nativo.
const out = `live_${login}_${Date.now()}.ts`
console.log(
	`\n→ gravando ao vivo em ${out} … (Ctrl+C pra encerrar; TS parcial já toca)`
)

const proc = Bun.spawn([FFMPEG, '-y', '-i', chosen.url, '-c', 'copy', out], {
	stdout: 'inherit',
	stderr: 'inherit',
})
const code = await proc.exited
console.log(
	code === 0 ? `\n✓ encerrado: ${out}` : `\n✗ ffmpeg saiu com código ${code}`
)
