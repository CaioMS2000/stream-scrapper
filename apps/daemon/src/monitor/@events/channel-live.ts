import type { Event } from '@/@shared/events'

// `startedAt` vem do próprio Twitch (`stream.createdAt`) — mais preciso que
// "quando detectamos". Pra live longa, útil pra saber duração real.
// `occurredAt` (da base Event) é quando o evento nasceu no daemon — útil
// pra rastrear latência entre a live começar e a gente notar.
export class ChannelLiveEvent implements Event {
	readonly occurredAt = new Date()

	constructor(
		readonly username: string,
		readonly startedAt: Date
	) {}
}

// Twitch não expõe "quando o stream terminou". O `occurredAt` da base já é
// o tempo de detecção — o stream real caiu em algum ponto entre o tick
// anterior e este, então o valor tem atraso de 0 a +intervalMs em relação
// ao offline real (nunca aponta antes; sempre igual ou depois).
export class ChannelOfflineEvent implements Event {
	readonly occurredAt = new Date()

	constructor(readonly username: string) {}
}
