// A costura de injeção de dependência do módulo: o TwitchClient fala com a rede
// só através desta interface. Em produção usa FetchHttp (embrulha fetch); no
// teste, um fake que devolve respostas canned — offline, determinístico.

export interface HttpResponse {
	ok: boolean
	status: number
	body: string
}

export interface TwitchHttp {
	postJson(
		url: string,
		body: unknown,
		headers?: Record<string, string>
	): Promise<unknown>
	getText(url: string): Promise<HttpResponse>
	head(url: string): Promise<{ ok: boolean; status: number }>
}

export class FetchHttp implements TwitchHttp {
	async postJson(
		url: string,
		body: unknown,
		headers?: Record<string, string>
	): Promise<unknown> {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body),
		})
		if (!res.ok) throw new Error(`gql HTTP ${res.status} — ${await res.text()}`)
		return res.json()
	}

	async getText(url: string): Promise<HttpResponse> {
		const res = await fetch(url)
		return { ok: res.ok, status: res.status, body: await res.text() }
	}

	async head(url: string): Promise<{ ok: boolean; status: number }> {
		const res = await fetch(url, { method: 'HEAD' })
		return { ok: res.ok, status: res.status }
	}
}
