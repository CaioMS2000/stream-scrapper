// record.ts — composition root MANUAL do caminho 3 (gravação ao vivo).
// Não é spike: fia os módulos REAIS (store + twitch + recorder) na mão, o mesmo
// papel que o monitor fará sozinho depois. Prova a composição mínima ao-vivo.
//
// Uso:  bun record.ts <login> [segundos] [qualidade]
//       login     = canal que precisa estar AO VIVO agora
//       segundos  = corta a captura (default 8, p/ sanity; 0 = ilimitado, grava até fechar)
//       qualidade = 'best' (padrão), 'chunked' (=source), '720p60', '720p'…
//
// Usa o SegmentPullerEngine: re-autentica quando o token vence (>20 min), então
// `bun record.ts <canal> 0` é o teste real da re-auth (deixa rodar além dos 20 min).
//
// Grava em ./data/<login>/<streamId>_<startedAt>/recording.mp4 (+ meta.json + linha
// em recordings). O streamId/startedAt aqui são SINTÉTICOS — os reais viriam do
// monitor via Helix (o que também habilitaria a recovery, caminho 2).

import { Recorder, SegmentPullerEngine } from './src/recorder'
import { SqliteStore } from './src/store'
import { TwitchClient } from './src/twitch'

const login = process.argv[2]?.toLowerCase()
if (!login) {
	console.error('uso: bun record.ts <login> [segundos] [qualidade]')
	process.exit(1)
}
// 0 (ou omitido como 0) → ilimitado; senão corta em N segundos.
const durationSeconds =
	(process.argv[3] ? Number(process.argv[3]) : 8) || undefined
const quality = process.argv[4] ?? 'best'

const store = new SqliteStore('./data')
const twitch = new TwitchClient()
const recorder = new Recorder({ store, engine: new SegmentPullerEngine() })

// 1) twitch resolve o manifesto live (token dance isLive → master do canal).
const resolved = await twitch.resolveLiveManifest(login)
if (!resolved.ok) {
	console.error(
		`✗ não deu pra resolver a live de "${login}": ${resolved.error} ` +
			`(o canal provavelmente está offline)`
	)
	process.exit(1)
}
console.log(`✓ live resolvida (${login} está no ar)`)
for (const v of resolved.manifest.variants) {
	const mbps = (v.bandwidth / 1e6).toFixed(2)
	console.log(
		`   ${v.name.padEnd(12)} ${(v.resolution || 'audio').padEnd(9)} ${mbps} Mbps`
	)
}

// 2) registra a stream no índice (sintético) — o recorder exige o vínculo.
const startedAt = Math.floor(Date.now() / 1000)
const streamId = `${login}_${Date.now()}`
store.upsertStream({
	stream_id: streamId,
	streamer_login: login,
	started_at: startedAt,
})

// 3) grava. durationSeconds corta a captura; sem ele, roda até a live fechar.
// refresh: re-resolve o manifesto quando o token vence (re-auth do puller).
console.log(
	`\n→ gravando ${durationSeconds ? `${durationSeconds}s` : 'até fechar'} de ${login} …`
)
const handle = await recorder.record(streamId, resolved.manifest, {
	quality,
	durationSeconds,
	refresh: () =>
		twitch.resolveLiveManifest(login).then(x => (x.ok ? x.manifest : null)),
})

console.log(`\n${handle.status === 'completed' ? '✓' : '✗'} ${handle.status}`)
console.log(`   arquivo: ${handle.storagePath}`)
const rec = store.listRecordings().at(-1)
console.log(`   recordings: status=${rec?.status} bytes=${rec?.bytes}`)
store.close()
