type Ctor<T> = new (...args: never[]) => T
type AsyncCallback<E> = (event: E) => Promise<void>

export class TypedEventChannel<TEvent> {
	private readonly callbacks = new Map<Ctor<TEvent>, AsyncCallback<TEvent>[]>()

	on<E extends TEvent>(type: Ctor<E>, callback: AsyncCallback<E>): void {
		const list = this.callbacks.get(type as Ctor<TEvent>) ?? []
		list.push(callback as AsyncCallback<TEvent>)
		this.callbacks.set(type as Ctor<TEvent>, list)
	}

	async emit(event: TEvent): Promise<void> {
		const ctor = (event as { constructor: unknown }).constructor as Ctor<TEvent>
		const list = this.callbacks.get(ctor)
		if (!list) return

		for (const callback of list) {
			await callback(event)
		}
	}
}
