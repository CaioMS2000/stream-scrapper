// O seam de rede do SegmentPuller: playlist (texto) + segmentos (binário). Em
// produção usa fetch; no teste, um fake que devolve playlists/bytes/403 canned —
// offline, determinístico. Espelha o TwitchHttp do módulo twitch.
//
// Nota de ownership: são leituras de CDN PÚBLICA (o ffmpeg já fazia isso direto).
// A superfície PRIVADA (token dance/re-auth) segue confinada no módulo twitch.

export interface TextResponse {
	ok: boolean
	status: number
	body: string
}

export interface BytesResponse {
	ok: boolean
	status: number
	bytes: Uint8Array
}

export interface SegmentFetcher {
	getText(url: string): Promise<TextResponse>
	getBytes(url: string): Promise<BytesResponse>
}

export class FetchSegmentFetcher implements SegmentFetcher {
	async getText(url: string): Promise<TextResponse> {
		const res = await fetch(url)
		return { ok: res.ok, status: res.status, body: await res.text() }
	}

	async getBytes(url: string): Promise<BytesResponse> {
		const res = await fetch(url)
		const bytes = res.ok
			? new Uint8Array(await res.arrayBuffer())
			: new Uint8Array()
		return { ok: res.ok, status: res.status, bytes }
	}
}
