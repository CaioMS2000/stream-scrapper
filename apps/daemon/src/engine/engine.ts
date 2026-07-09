import type { Store } from '../store'
import type { TwitchClient } from '../twitch/client'

export type EngineProps = {
	twitch: TwitchClient
	store: Store
}

export class Engine {
	constructor(private props: EngineProps) {}

	get twitch() {
		return this.props.twitch
	}

	get store() {
		return this.props.store
	}
}
