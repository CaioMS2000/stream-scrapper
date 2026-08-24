// Hosts de CDN confirmados empiricamente contra streams reais — ver
// apps/daemon/spikes/FINDINGS.md (seções 3, 4 e 6) — mais os 2 candidatos
// originais documentados pela comunidade (TwitchRecover/VodRecovery), que
// nunca bateram nos nossos testes reais mas ficam como candidatos baratos.
//
// Lista ESTÁTICA de propósito. Harvesting automático (extrair hosts reais
// de playlists de VODs existentes, feito manualmente hoje via
// apps/daemon/spikes/04-cdn-host-harvest.sh) não virou código de produção
// nesta fatia — não existe ainda nenhum caminho (A/C, ver
// docs/design/002-download-de-vods.md) que descubra um `vodId`
// organicamente pra alimentar um harvester automático. Até lá, adicionar
// hosts novos aqui é manual: rode o script de spike contra algum canal com
// VODs públicas e cole o resultado.
export const KNOWN_CDN_HOSTS: readonly string[] = [
	'd3fi1amfgojobc.cloudfront.net',
	'dgeft87wbj63p.cloudfront.net',
	'd1m7jfoe9zdc1j.cloudfront.net',
	'vod-secure.twitch.tv',
	'd2nvs31859zcd8.cloudfront.net',
]
