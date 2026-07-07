import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BytesResponse, SegmentFetcher, TextResponse } from './http.ts'
import { SegmentPullerEngine } from './puller.ts'

// --- helpers de fixture ---
const ok = (body: string): TextResponse => ({ ok: true, status: 200, body })
const forbidden = (): TextResponse => ({ ok: false, status: 403, body: '' })

// TARGETDURATION:0 → o loop não dorme (testes rápidos e determinísticos).
function playlist(mediaSeq: number, segs: string[], endlist = false): string {
	const lines = [
		'#EXTM3U',
		'#EXT-X-TARGETDURATION:0',
		`#EXT-X-MEDIA-SEQUENCE:${mediaSeq}`,
	]
	for (const s of segs) {
		lines.push('#EXTINF:2.0,')
		lines.push(s)
	}
	if (endlist) lines.push('#EXT-X-ENDLIST')
	return lines.join('\n')
}

// fake fetcher: getText roteirizado por chamada; getBytes devolve os bytes "[url]"
// (dá pra assertar ordem/conteúdo) e registra cada URL baixada.
function fakeFetcher(
	texts: TextResponse[] | ((call: number) => TextResponse),
	bytesOverride?: (url: string) => BytesResponse
): { fetcher: SegmentFetcher; segCalls: string[] } {
	const segCalls: string[] = []
	let call = 0
	const fetcher: SegmentFetcher = {
		async getText() {
			const t =
				typeof texts === 'function'
					? texts(call)
					: (texts[Math.min(call, texts.length - 1)] as TextResponse)
			call++
			return t
		},
		async getBytes(url) {
			segCalls.push(url)
			if (bytesOverride) return bytesOverride(url)
			return {
				ok: true,
				status: 200,
				bytes: new TextEncoder().encode(`[${url}]`),
			}
		},
	}
	return { fetcher, segCalls }
}

function withTs(fn: (tsPath: string) => Promise<void>) {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), 'pull-'))
		try {
			await fn(join(dir, 'rec.ts'))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}
}

const BASE = 'https://cdn/live.m3u8'

test(
	'pull feliz + ENDLIST: concatena os segmentos na ordem e encerra limpo',
	withTs(async tsPath => {
		const { fetcher, segCalls } = fakeFetcher([
			ok(
				playlist(0, [
					'https://cdn/s0.ts',
					'https://cdn/s1.ts',
					'https://cdn/s2.ts',
				])
			),
			ok(
				playlist(
					0,
					['https://cdn/s0.ts', 'https://cdn/s1.ts', 'https://cdn/s2.ts'],
					true
				)
			),
		])
		const engine = new SegmentPullerEngine(fetcher)
		await engine.capture(BASE, tsPath) // resolve = fim limpo

		expect(segCalls).toEqual([
			'https://cdn/s0.ts',
			'https://cdn/s1.ts',
			'https://cdn/s2.ts',
		])
		expect(await Bun.file(tsPath).text()).toBe(
			'[https://cdn/s0.ts][https://cdn/s1.ts][https://cdn/s2.ts]'
		)
	})
)

test(
	'dedupe entre polls: janela sobreposta baixa cada segmento 1× só',
	withTs(async tsPath => {
		const { fetcher, segCalls } = fakeFetcher([
			ok(
				playlist(0, [
					'https://cdn/s0.ts',
					'https://cdn/s1.ts',
					'https://cdn/s2.ts',
				])
			),
			// janela desliza: mediaSeq=1 → s1=seq1, s2=seq2, s3=seq3 (só s3 é novo)
			ok(
				playlist(1, [
					'https://cdn/s1.ts',
					'https://cdn/s2.ts',
					'https://cdn/s3.ts',
				])
			),
			ok(playlist(1, ['https://cdn/s3.ts'], true)),
		])
		const engine = new SegmentPullerEngine(fetcher)
		await engine.capture(BASE, tsPath)

		expect(segCalls).toEqual([
			'https://cdn/s0.ts',
			'https://cdn/s1.ts',
			'https://cdn/s2.ts',
			'https://cdn/s3.ts',
		])
	})
)

test(
	're-auth em 403: chama refresh, troca de URL e completa',
	withTs(async tsPath => {
		const { fetcher, segCalls } = fakeFetcher([
			forbidden(), // token venceu na 1ª leitura
			ok(playlist(0, ['https://cdn2/s0.ts'], true)), // URL nova entrega e fecha
		])
		let refreshCount = 0
		const engine = new SegmentPullerEngine(fetcher)
		await engine.capture(BASE, tsPath, {
			refresh: async () => {
				refreshCount++
				return 'https://cdn2/live.m3u8'
			},
		})

		expect(refreshCount).toBe(1)
		expect(segCalls).toEqual(['https://cdn2/s0.ts'])
		expect(await Bun.file(tsPath).text()).toBe('[https://cdn2/s0.ts]')
	})
)

test(
	'403 sem refresh → lança (interrupção real → recorder marca failed)',
	withTs(async tsPath => {
		const { fetcher } = fakeFetcher([forbidden()])
		const engine = new SegmentPullerEngine(fetcher)
		await expect(engine.capture(BASE, tsPath)).rejects.toThrow(/interrompida/)
	})
)

test(
	'bound por durationSeconds: playlist sem ENDLIST encerra pelo tempo',
	withTs(async tsPath => {
		// sempre a mesma playlist (nunca fecha) → só o durationSeconds pode parar.
		const { fetcher, segCalls } = fakeFetcher(() =>
			ok(playlist(0, ['https://cdn/s0.ts']))
		)
		const engine = new SegmentPullerEngine(fetcher)
		await engine.capture(BASE, tsPath, { durationSeconds: 0.001 })

		// dedupe → s0 baixado 1×; e a captura RETORNOU (não rodou pra sempre)
		expect(segCalls).toEqual(['https://cdn/s0.ts'])
	})
)
