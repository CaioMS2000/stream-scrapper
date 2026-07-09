import { mkdirSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { type ChannelModel, channelsTable } from '../database/schemas/channel'
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

	ensureChannelPath(channel: string) {
		mkdirSync(`${this.props.rootPath}/${channel}`, { recursive: true })
	}

	async findChannel(channel: string): Promise<ChannelModel | null> {
		const record = this.drizzle
			.select()
			.from(channelsTable)
			.where(eq(channelsTable.login, channel))
			.get()
		return record ?? null
	}
}
