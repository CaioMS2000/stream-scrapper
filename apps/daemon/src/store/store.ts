import type { DrizzleClient } from '../lib/drizzle'

export type StoreProps = {
	// Raiz física da persistência: guardada aqui porque os vídeos baixados
	// futuramente também vão viver embaixo dela.
	rootPath: string
	drizzle: DrizzleClient
}

export class Store {
	constructor(private readonly props: StoreProps) {}

	get rootPath() {
		return this.props.rootPath
	}

	get drizzle() {
		return this.props.drizzle
	}
}
