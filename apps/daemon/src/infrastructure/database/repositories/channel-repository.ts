import { eq } from 'drizzle-orm'
import type { ChannelModel } from '@/application/models'
import type {
	AddChannelOptionalParams,
	ChannelRepository,
	ChannelUpdateParams,
} from '@/application/repositories'
import type { DrizzleClient } from '@/lib/drizzle'
import { channelsTable } from '../schemas'

export type ChannelRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleChannelRepository implements ChannelRepository {
	constructor(private readonly props: ChannelRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async findChannel(channel: string): Promise<ChannelModel | null> {
		const record = this.drizzle
			.select()
			.from(channelsTable)
			.where(eq(channelsTable.username, channel.toLowerCase()))
			.get()
		return record ?? null
	}

	async addChannel(
		channel: string,
		params?: AddChannelOptionalParams
	): Promise<ChannelModel> {
		// `username` fica sempre lowercase — política do repositório (ver JSDoc
		// em ChannelRepository). `displayName` preserva o case original vindo
		// da Twitch (ou o input cru como fallback), que é o nome pra humano.
		const username = channel.toLowerCase()
		const qualityPref = params?.qualityPref ?? 'source'
		const displayName = params?.name ?? channel
		const autoRecord = params?.autoRecord ?? undefined
		const record = this.drizzle
			.insert(channelsTable)
			.values({ username, qualityPref, displayName, autoRecord })
			.returning()
			.get()
		return record
	}

	async updateChannel(channel: ChannelUpdateParams): Promise<ChannelModel> {
		const [firstRecord] = await this.drizzle
			.update(channelsTable)
			.set({
				qualityPref: channel.qualityPref,
				displayName: channel.displayName,
				autoRecord: channel.autoRecord,
				isLive: channel.isLive,
			})
			.where(eq(channelsTable.id, channel.id))
			.returning()

		if (!firstRecord) {
			throw new Error(`PANIC! Channel with id ${channel.id} failed to update!`)
		}

		return firstRecord
	}

	async deleteChannel(channel: string): Promise<void> {
		await this.drizzle
			.delete(channelsTable)
			.where(eq(channelsTable.username, channel.toLowerCase()))
	}

	async getAllChannels(): Promise<ChannelModel[]> {
		return this.drizzle.select().from(channelsTable).all()
	}
}
