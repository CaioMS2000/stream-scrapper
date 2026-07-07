// A VOLATILIDADE isolada (Modulo_Twitch §6): tudo que a Twitch pode mudar sem
// aviso vive aqui, num lugar patchável. Injetável no TwitchClient (const TS por
// ora; arquivo twitch_config.json fica como refinamento futuro).

export interface TwitchConfig {
	clientId: string
	gqlUrl: string
	usherVodBase: string
	usherLiveBase: string
	cdnHosts: string[]
	playbackQuery: string
	streamMetadataQuery: string
}

export const defaultTwitchConfig: TwitchConfig = {
	clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko', // web client público (Referencia §3)
	gqlUrl: 'https://gql.twitch.tv/gql',
	usherVodBase: 'https://usher.ttvnw.net/vod',
	// live usa o endpoint de CANAL (não o de vod) — Modulo_Twitch §4A.
	usherLiveBase: 'https://usher.ttvnw.net/api/channel/hls',
	// ⚠ volátil: a Twitch adiciona hosts com o tempo (TwitchRecover mantém listas).
	cdnHosts: [
		'd3fi1amfgojobc.cloudfront.net',
		'vod-secure.twitch.tv',
		'vod-metro.twitch.tv',
		'd2nvs31859zcd8.cloudfront.net',
		'dqrpb9wgowsf5.cloudfront.net',
		'd2e2de1etea730.cloudfront.net',
		'dgeft87wbj63p.cloudfront.net',
		'ds0h3roq6wcgc.cloudfront.net',
	],
	// A query gql INTEIRA (não o persisted hash volátil) → sem dependência de hash.
	// É o truque provado nos spikes; some a maior fonte de quebra do §4A/§6.
	playbackQuery:
		'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {' +
		'  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename }' +
		'  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename }' +
		'}',
	// Detecção de live + metadata (caminho do monitor). Query INTEIRA (não persisted
	// hash) — mesmo truque do playbackQuery. Provada: live → user.stream populado;
	// offline → user.stream null. createdAt é ISO 8601. user.id é o user_id estável.
	streamMetadataQuery:
		'query StreamMetadata($login: String!) {' +
		'  user(login: $login) {' +
		'    id' +
		'    login' +
		'    stream { id createdAt title type game { name } }' +
		'  }' +
		'}',
}
