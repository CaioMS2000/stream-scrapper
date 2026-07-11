import type { Event } from './event'
import { TypedEventChannel } from './typed-event-channel'

type Ctor<T> = new (...args: never[]) => T
type Subscriber<E extends Event> = (event: E) => Promise<void>

export class EventBus {
	private readonly channel = new TypedEventChannel<Event>()

	subscribe<E extends Event>(type: Ctor<E>, subscriber: Subscriber<E>): void {
		this.channel.on(type, subscriber)
	}

	async publish<E extends Event>(event: E): Promise<void> {
		await this.channel.emit(event)
	}
}
