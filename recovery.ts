// recovery.ts — descartável. O spike do caminho 2 (recovery por hash da CDN).
// O mais curto dos três: NÃO tem token dance, NÃO precisa de conta.
//
// A ideia (Modulo_Twitch §4B): a URL do VOD na CDN é previsível a partir de
// login + stream_id + started_at. A restrição "sub-only/oculto" mora no player
// da Twitch, não no arquivo no bucket — então quem tem os 3 dados alcança o VOD.
//
//   base = "{login}_{streamId}_{startedAt}"
//   hash = SHA1(base) em hex, primeiros 20 chars
//   path = "/{hash}_{base}/chunked/index-dvr.m3u8"
//   → HEAD nesse path contra a lista de hosts de CDN; o 1º que der 200 vence.
//
// Uso:  bun recovery.ts <login> <streamId> <startedAt>
//
// Caso de teste determinístico (extraído do path de segmento do VOD 2800325069):
//   bun recovery.ts apofigeaa 317727339494 1781869331
//   → hash esperado: b2fa85c40d5d5513b56a  (a gente já sabe a resposta)

const login = process.argv[2]?.toLowerCase()
const streamId = process.argv[3]
const startedAt = process.argv[4]
if (!login || !streamId || !startedAt) {
	console.error('uso: bun recovery.ts <login> <streamId> <startedAt>')
	process.exit(1)
}

// Hosts de CDN da Twitch — VOLÁTIL (Modulo_Twitch §6): a Twitch adiciona hosts
// novos com o tempo; projetos tipo TwitchRecover mantêm listas atualizadas.
const CDN_HOSTS = [
	'd3fi1amfgojobc.cloudfront.net', // o observado no VOD de teste (fica 1º p/ rapidez)
	'vod-secure.twitch.tv',
	'vod-metro.twitch.tv',
	'd2nvs31859zcd8.cloudfront.net',
	'dqrpb9wgowsf5.cloudfront.net',
	'd2e2de1etea730.cloudfront.net',
	'dgeft87wbj63p.cloudfront.net',
	'ds0h3roq6wcgc.cloudfront.net',
]

function cdnHash(base: string): string {
	return new Bun.CryptoHasher('sha1').update(base).digest('hex').slice(0, 20)
}

function buildPath(ts: number): { base: string; hash: string; path: string } {
	const base = `${login}_${streamId}_${ts}`
	const hash = cdnHash(base)
	return { base, hash, path: `/${hash}_${base}/chunked/index-dvr.m3u8` }
}

// Probe: primeiro host que responde 200 no HEAD vence.
async function probe(path: string): Promise<string | null> {
	for (const host of CDN_HOSTS) {
		const url = `https://${host}${path}`
		try {
			const res = await fetch(url, { method: 'HEAD' })
			if (res.ok) return url
		} catch {
			// host fora do ar / DNS — ignora e tenta o próximo
		}
	}
	return null
}

const base0 = Number(startedAt)
const exact = buildPath(base0)
console.log(`base:  ${exact.base}`)
console.log(`hash:  ${exact.hash}   ← SHA1(base)[:20]`)

// Janela ±N s: trackers às vezes arredondam o started_at (Modulo_Twitch §4B).
// Testa o exato primeiro; se falhar, vai abrindo em volta.
const WINDOW = 2
let found: string | null = null
let usedTs = base0
for (let off = 0; off <= WINDOW && !found; off++) {
	const candidates = off === 0 ? [base0] : [base0 - off, base0 + off]
	for (const ts of candidates) {
		found = await probe(buildPath(ts).path)
		if (found) {
			usedTs = ts
			break
		}
	}
}

if (!found) {
	console.log(
		'\n✗ não achei na CDN — VOD fora da janela de retenção (~7–60d) ou dados incorretos'
	)
	process.exit(1)
}

console.log('\n✓ achado na CDN — sem token, sem conta:')
console.log(`   ${found}`)
if (usedTs !== base0) {
	console.log(`   (started_at ajustado em ${usedTs - base0}s pela janela)`)
}
console.log(
	`\n→ daqui o downloader faria: ffmpeg -i "<url acima>" -c copy vod.mp4`
)
