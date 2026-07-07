import { FfmpegLiveEngine } from './engine.ts'
import { FetchSegmentFetcher, type SegmentFetcher } from './http.ts'
import type { CaptureEngine, CaptureOpts } from './types.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface ParsedPlaylist {
	mediaSeq: number // número de sequência do PRIMEIRO segmento listado
	segments: string[] // URIs dos segmentos, na ordem
	hasEndlist: boolean // #EXT-X-ENDLIST → a live fechou
	targetDurationMs?: number // #EXT-X-TARGETDURATION → cadência do poll
}

// Parse mínimo de media playlist HLS. Numa media playlist as ÚNICAS linhas "cruas"
// (sem #) são URIs de segmento; o resto é metadata comentada.
function parsePlaylist(body: string): ParsedPlaylist {
	let mediaSeq = 0
	let targetDurationMs: number | undefined
	let hasEndlist = false
	const segments: string[] = []
	for (const raw of body.split('\n')) {
		const line = raw.trim()
		if (!line) continue
		if (line.startsWith('#')) {
			if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
				mediaSeq = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0
			} else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
				targetDurationMs =
					Number(line.slice('#EXT-X-TARGETDURATION:'.length)) * 1000
			} else if (line === '#EXT-X-ENDLIST') {
				hasEndlist = true
			}
			continue
		}
		segments.push(line) // linha crua = URI de segmento
	}
	return { mediaSeq, segments, hasEndlist, targetDurationMs }
}

// O motor "limpo" (Modulo_Recorder §3, opção C): o próprio loop lê a playlist rolante,
// baixa os .ts novos (dedupe por número de sequência) e RE-AUTENTICA pelo refresh quando
// o token vence — ffmpeg só no remux. Sobrevive a live longa (>20 min) e desambigua o
// fim (vê 403 vs ENDLIST direto, não o exit code que mente). O motor é PURO: a re-auth
// entra por um closure (opts.refresh), então nenhum acoplamento a twitch aqui.
export class SegmentPullerEngine implements CaptureEngine {
	private readonly ffmpeg = new FfmpegLiveEngine() // reuso só pro remux .ts→.mp4

	constructor(
		private readonly fetcher: SegmentFetcher = new FetchSegmentFetcher()
	) {}

	remux(tsPath: string, mp4Path: string): Promise<void> {
		return this.ffmpeg.remux(tsPath, mp4Path)
	}

	async capture(
		mediaPlaylistUrl: string,
		tsPath: string,
		opts?: CaptureOpts
	): Promise<void> {
		const writer = Bun.file(tsPath).writer()
		const refresh = opts?.refresh
		const start = Date.now()
		let url = mediaPlaylistUrl
		let lastSeq = -1

		// 403 → tenta re-autenticar. Devolve URL fresca, null (live acabou), ou LANÇA
		// se não há refresh (interrupção real → o recorder marca failed).
		const reauth = async (): Promise<string | null> => {
			if (!refresh) throw new Error('403 sem refresh — captura interrompida')
			return refresh()
		}

		try {
			for (;;) {
				const res = await this.fetcher.getText(url)
				if (res.status === 403) {
					const fresh = await reauth()
					if (fresh === null) break // fim limpo
					url = fresh
					continue
				}
				if (!res.ok) throw new Error(`playlist HTTP ${res.status}`)

				const { mediaSeq, segments, hasEndlist, targetDurationMs } =
					parsePlaylist(res.body)

				let reauthed = false
				for (let i = 0; i < segments.length; i++) {
					const seq = mediaSeq + i
					if (seq <= lastSeq) continue // dedupe pelo número de sequência
					const uri = segments[i]
					if (!uri) continue
					const segUrl = new URL(uri, url).toString()

					const b = await this.fetcher.getBytes(segUrl)
					if (b.status === 403) {
						const fresh = await reauth()
						if (fresh === null) return // fim limpo (finally faz o flush)
						url = fresh
						reauthed = true
						break // re-busca a playlist fresca
					}
					if (!b.ok) throw new Error(`segmento HTTP ${b.status}`)
					writer.write(b.bytes)
					writer.flush() // durabilidade: o parcial já toca
					lastSeq = seq
				}
				if (reauthed) continue

				if (hasEndlist) break // fim natural da live
				if (
					opts?.durationSeconds &&
					(Date.now() - start) / 1000 >= opts.durationSeconds
				) {
					break // bound (sanity)
				}
				await sleep(targetDurationMs ?? 2000)
			}
		} finally {
			await writer.end()
		}
	}
}
