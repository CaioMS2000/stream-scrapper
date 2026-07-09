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

type AddChannelOptionalParams = {
	qualityPref?: ChannelModel['qualityPref']
	name: ChannelModel['displayName']
	autoRecord?: ChannelModel['autoRecord']
}

export class Store {
	constructor(private readonly props: StoreProps) {}

	private get rootPath() {
		return this.props.rootPath
	}

	private get drizzle() {
		return this.props.drizzle
	}

	ensureChannelPath(channel: string) {
		mkdirSync(`${this.props.rootPath}/${channel}`, { recursive: true })
	}

	async findChannel(channel: string): Promise<ChannelModel | null> {
		const record = this.drizzle
			.select()
			.from(channelsTable)
			.where(eq(channelsTable.username, channel))
			.get()
		return record ?? null
	}

	async addChannel(
		channel: string,
		params?: AddChannelOptionalParams
	): Promise<ChannelModel> {
		const qualityPref = params?.qualityPref ?? 'best'
		const displayName = params?.name ?? channel
		const autoRecord = params?.autoRecord ?? undefined
		const record = this.drizzle
			.insert(channelsTable)
			.values({ username: channel, qualityPref, displayName, autoRecord })
			.returning()
			.get()
		return record
	}
}
