// m3u8 é texto plano simples o suficiente pra não precisar de lib de
// parsing: qualquer linha não-vazia que não comece com `#` é um path de
// segment relativo ao mesmo diretório do playlist (ver os exemplos reais
// em apps/daemon/spikes/FINDINGS.md). Compartilhado entre
// infrastructure/cdn-recovery e infrastructure/official-vod — mesmo
// formato de media playlist nos dois casos.
export function parseSegments(playlistBody: string): string[] {
	return playlistBody
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#'))
}
