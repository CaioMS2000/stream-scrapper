import { eq } from 'drizzle-orm'
import type { HarvestChannelRepository } from '@/application/repositories'
import type { DrizzleClient } from '@/lib/drizzle'
import { harvestChannelTable } from '../schemas'

export type HarvestChannelRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleHarvestChannelRepository
	implements HarvestChannelRepository
{
	constructor(private readonly props: HarvestChannelRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async listChannels(): Promise<string[]> {
		const records = this.drizzle
			.select({ channelName: harvestChannelTable.channelName })
			.from(harvestChannelTable)
			.all()
		return records.map(r => r.channelName)
	}

	async hasChannel(channelName: string): Promise<boolean> {
		const record = this.drizzle
			.select()
			.from(harvestChannelTable)
			.where(eq(harvestChannelTable.channelName, channelName.toLowerCase()))
			.get()
		return record !== undefined
	}

	async addChannel(channelName: string): Promise<void> {
		await this.drizzle
			.insert(harvestChannelTable)
			.values({ channelName: channelName.toLowerCase() })
			.onConflictDoNothing({ target: harvestChannelTable.channelName })
	}

	async removeChannel(channelName: string): Promise<void> {
		await this.drizzle
			.delete(harvestChannelTable)
			.where(eq(harvestChannelTable.channelName, channelName.toLowerCase()))
	}
}
