export type ChannelLiveEvent =
	// `startedAt` vem do próprio Twitch (`stream.createdAt`) — mais preciso que
	// "quando detectamos". Pra live longa, útil pra saber duração real.
	| { type: 'live'; username: string; startedAt: Date }
	// `at` aqui é o tempo de detecção — Twitch não expõe "quando o stream
	// terminou". O stream real caiu em algum ponto entre o tick anterior e este,
	// então o valor tem atraso de 0 a +intervalMs em relação ao offline real
	// (nunca aponta antes; sempre igual ou depois).
	| { type: 'offline'; username: string; at: Date }
