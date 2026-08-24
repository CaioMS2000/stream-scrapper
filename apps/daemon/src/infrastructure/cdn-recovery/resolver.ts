import { computeCdnHash } from './hash'
import { KNOWN_CDN_HOSTS } from './host-pool'

type ResolveViaCdnParams = {
	channelName: string
	streamId: string
	startedAt: Date
}

// Assinatura mínima, não `typeof fetch` inteiro (que no Bun inclui estáticos
// como `preconnect`) — só o suficiente pra injetar um fake em teste.
type FetchLike = (url: string) => Promise<Response>

type ResolveViaCdnOptions = {
	hosts?: readonly string[]
	fetchImpl?: FetchLike
}

export type CdnResolution = {
	host: string
	baseUrl: string
	segments: string[]
}

// Tenta reconstruir e localizar o VOD na CDN, sem depender de `vodId` nem
// de token — só dos dados que a `stream` table já persiste. Ver
// docs/design/002-download-de-vods.md (seção B) e
// apps/daemon/spikes/FINDINGS.md pro raciocínio completo e a validação
// empírica por trás disso (inclusive recuperação confirmada de conteúdo
// que a API oficial da Twitch não lista de jeito nenhum).
//
// Probabilístico por natureza: quanto maior `hosts`, maior a chance de
// acerto, mas não há garantia — cada VOD parece pinada a um host de
// armazenamento específico, não um pool espelhado onde qualquer host
// ativo serve qualquer VOD (hipótese testada e refutada, ver Risco #5 do
// design doc).
export async function resolveViaCdn(
	{ channelName, streamId, startedAt }: ResolveViaCdnParams,
	options: ResolveViaCdnOptions = {}
): Promise<CdnResolution | null> {
	const hosts = options.hosts ?? KNOWN_CDN_HOSTS
	const fetchImpl = options.fetchImpl ?? fetch
	const { hashable, urlhash } = computeCdnHash({
		channelName,
		streamId,
		startedAt,
	})

	for (const host of hosts) {
		const baseUrl = `https://${host}/${urlhash}_${hashable}/chunked`
		const playlistUrl = `${baseUrl}/index-dvr.m3u8`

		let response: Response
		try {
			response = await fetchImpl(playlistUrl)
		} catch {
			// Falha de rede/DNS num host candidato não deve abortar a busca —
			// só segue pro próximo (mesmo comportamento visto em
			// apps/daemon/spikes/02-cdn-reconstruction.sh, host que não resolve).
			continue
		}

		if (!response.ok) continue

		const body = await response.text()
		const segments = parseSegments(body)
		if (segments.length === 0) continue

		return { host, baseUrl, segments }
	}

	return null
}

// m3u8 é texto plano simples o suficiente pra não precisar de lib de
// parsing: qualquer linha não-vazia que não comece com `#` é um path de
// segment relativo ao mesmo diretório do playlist (ver os exemplos reais
// em apps/daemon/spikes/FINDINGS.md).
function parseSegments(playlistBody: string): string[] {
	return playlistBody
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0 && !line.startsWith('#'))
}
