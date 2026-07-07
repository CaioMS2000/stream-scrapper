// watch.ts — composition root AUTOMÁTICO (o "daemon" mínimo do motor headless).
// Diferente do record.ts (disparo manual), aqui o MONITOR é quem decide: pollia o
// canal, detecta o go-live sozinho, registra a stream e dispara o recorder. É o
// papel que a API/daemon fará por cima depois — aqui, fiado na mão pra provar o loop.
//
// Uso:  bun watch.ts <login> [segundos] [intervalo_ms]
//       login        = canal a monitorar
//       segundos     = corta cada gravação (default 15, p/ sanity; omita p/ ilimitado)
//       intervalo_ms = período do poll (default 15000 na sanity; 60000 em uso real)
//
// Ctrl+C encerra. Grava em ./data/<login>/<streamId>_<startedAt>/recording.mp4.

import { StreamMonitor } from './src/monitor'
import { Recorder, SegmentPullerEngine } from './src/recorder'
import { SqliteStore } from './src/store'
import { TwitchClient } from './src/twitch'

const login = process.argv[2]?.toLowerCase()
if (!login) {
	console.error('uso: bun watch.ts <login> [segundos] [intervalo_ms]')
	process.exit(1)
}
const durationSeconds = Number(process.argv[3] ?? 15)
const intervalMs = Number(process.argv[4] ?? 15_000)

const store = new SqliteStore('./data')
const twitch = new TwitchClient()
// motor puller: sobrevive à expiração do token (>20 min) — o monitor injeta o refresh.
const recorder = new Recorder({ store, engine: new SegmentPullerEngine() })
const monitor = new StreamMonitor({
	store,
	twitch,
	recorder,
	intervalMs,
	recordDefaults: { durationSeconds }, // sanity: cada gravação auto-finaliza
})

// registra o streamer como monitorado + auto_record ligado.
store.addStreamer({
	login,
	monitored_since: Math.floor(Date.now() / 1000),
	auto_record: 1,
})

console.log(
	`→ monitorando ${login} (poll ${intervalMs}ms, grava ${durationSeconds}s) … Ctrl+C encerra`
)
monitor.start()

// encerramento gracioso: para o loop e fecha o store.
process.on('SIGINT', () => {
	console.log('\n→ encerrando monitor …')
	monitor.stop()
	console.log('recordings:', store.listRecordings())
	store.close()
	process.exit(0)
})
