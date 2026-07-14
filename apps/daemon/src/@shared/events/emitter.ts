export type Listener<T> = (event: T) => void | Promise<void>

// Convenção deste projeto: **uma instância de Emitter por classe emissora**,
// injetada via construtor. Nunca compartilhar a mesma instância entre classes
// diferentes — se sentir vontade, promover pro Estágio 3 (EventBus) descrito
// em `notes/events-evolution.md`. Ver JSDoc nas props (ex: ChannelMonitorProps.events).
//
// Isolamento de erro por listener: um handler bugado não derruba os outros
// nem o `emit()`. O `label` só aparece no log — útil quando múltiplos
// emissores coexistem e você precisa saber de qual saiu o erro.
export class Emitter<T> {
	private listeners: Listener<T>[] = []

	constructor(private readonly label = 'emitter') {}

	on(listener: Listener<T>): void {
		this.listeners.push(listener)
	}

	async emit(event: T): Promise<void> {
		for (const listener of this.listeners) {
			try {
				await listener(event)
			} catch (error) {
				console.error(`[${this.label}] listener failed:`, error)
			}
		}
	}
}
