// Contrato base pra todos os eventos que trafegam no bus. `occurredAt`
// marca "quando o evento nasceu no daemon" — útil pra handlers cross-cutting
// (log, audit, métrica) que querem timestamp uniforme sem depender do shape
// específico do evento.
export interface Event {
	readonly occurredAt: Date
}

type Handler<E> = (event: E) => void | Promise<void>
type Ctor<E = unknown> = new (...args: any[]) => E

// Bus central pra eventos in-process. Roteia por identidade da classe do
// evento (via `event.constructor` como chave no Map).
//
// **Isolamento de erro por handler**: um handler bugado NÃO derruba os
// outros nem o `publish()`. Crítico pra daemon 24/7 — se um handler crashar
// (webhook morto, métrica quebrada), os demais (incluindo invariantes tipo
// Engine.onStreamStarted) continuam rodando.
//
// Handlers podem ser sync OU async (`void | Promise<void>`); `publish` faz
// await em ordem de subscribe.

export class EventBus {
	private handlers = new Map<Ctor, Handler<any>[]>()

	subscribe<E extends Event>(EventClass: Ctor<E>, handler: Handler<E>): void {
		const list = this.handlers.get(EventClass) ?? []
		list.push(handler as Handler<any>)
		this.handlers.set(EventClass, list)
	}

	async publish<E extends Event>(event: E): Promise<void> {
		const list = this.handlers.get(event.constructor as Ctor) ?? []
		for (const handler of list) {
			try {
				await handler(event)
			} catch (err) {
				console.error('[bus] handler failed:', err)
			}
		}
	}
}
