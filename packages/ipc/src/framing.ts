// Enquadramento das mensagens no fio. Um unix socket é um stream de bytes, não
// de mensagens — então precisamos delimitar. Convenção: NDJSON (um JSON por
// linha, terminado em `\n`). Fica no package compartilhado pra os dois lados
// não divergirem no framing.

export function encodeMessage(message: unknown): string {
	return `${JSON.stringify(message)}\n`
}

// Acumula os chunks que chegam pelo socket (que podem cortar uma mensagem no
// meio, ou trazer várias de uma vez) e devolve apenas as linhas completas.
export class LineBuffer {
	private pending = ''

	push(chunk: string): string[] {
		this.pending += chunk
		const parts = this.pending.split('\n')
		// A última parte é o resto incompleto (sem `\n` ainda) — segura pro
		// próximo chunk.
		this.pending = parts.pop() ?? ''
		return parts.filter(line => line.length > 0)
	}
}
