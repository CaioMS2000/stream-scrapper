// spike.ts — descartável. Prova a única parte incerta do projeto:
// a dança de token com a Twitch funciona HOJE e eu consigo bytes no disco?
//
// Escopo: baixar um VOD PÚBLICO (caminho 1, o mais simples — playlist fechada,
// um token só, ffmpeg cru serve). Sem módulos, sem store, sem arquitetura.
//
// Uso:  bun index.ts <vodID>
//       (o vodID é o número em twitch.tv/videos/1234567890)
//
// Usa o ffmpeg de ./bin (caminho absoluto via import.meta.dir), com fallback pro PATH.

import { join } from 'node:path'

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // web client público (Referencia_Tecnica §3)

// Binário local em ./bin tem prioridade; se não existir, cai pro "ffmpeg" do PATH.
// Absoluto via import.meta.dir → funciona independente do cwd de onde você roda.
const LOCAL_FFMPEG = join(import.meta.dir, 'bin', 'ffmpeg')
const FFMPEG = (await Bun.file(LOCAL_FFMPEG).exists()) ? LOCAL_FFMPEG : 'ffmpeg'

const vodID = process.argv[2]
if (!vodID) {
	console.error('uso: bun spike.ts <vodID>')
	process.exit(1)
}

// 1) Token dance — gql PlaybackAccessToken.
// Truque: mandamos a QUERY inteira (não o persisted hash volátil), então isso
// NÃO depende do hash que expira. É o que streamlink/yt-dlp fazem.
async function getVodToken(
	id: string
): Promise<{ value: string; signature: string }> {
	const body = {
		operationName: 'PlaybackAccessToken_Template',
		query:
			'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {' +
			'  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename }' +
			'  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }' +
			'}',
		variables: {
			isLive: false,
			login: '',
			isVod: true,
			vodID: id,
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
	const tok = json?.data?.videoPlaybackAccessToken
	if (!tok) throw new Error(`sem token na resposta: ${JSON.stringify(json)}`)
	return { value: tok.value, signature: tok.signature }
}

// 2) usher → master m3u8 (lista as qualidades).
function usherUrl(id: string, token: string, sig: string): string {
	const p = new URLSearchParams({
		token,
		sig,
		allow_source: 'true',
		allow_audio_only: 'true',
		player: 'twitchweb',
		platform: 'web',
	})
	return `https://usher.ttvnw.net/vod/${id}.m3u8?${p}`
}

const { value, signature } = await getVodToken(vodID)
console.log('✓ token obtido')

const master = usherUrl(vodID, value, signature)
const mres = await fetch(master)
if (!mres.ok)
	throw new Error(`usher falhou: HTTP ${mres.status} — ${await mres.text()}`)
const playlist = await mres.text()
console.log('✓ master m3u8 obtido:\n')
console.log(playlist.split('\n').slice(0, 8).join('\n'), '\n...')

// 3) ffmpeg cru no master — ele escolhe uma variante e muxa pra mp4.
// (-c copy = sem recodificar; aac_adtstoasc conserta áudio AAC no TS→MP4, Ref §7)
const out = `vod_${vodID}.mp4`
console.log(
	`\n→ baixando com ffmpeg para ${out} … (Ctrl+C pra parar antes do fim)`
)

const proc = Bun.spawn(
	[FFMPEG, '-y', '-i', master, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', out],
	{ stdout: 'inherit', stderr: 'inherit' }
)
const code = await proc.exited
console.log(
	code === 0 ? `\n✓ pronto: ${out}` : `\n✗ ffmpeg saiu com código ${code}`
)
