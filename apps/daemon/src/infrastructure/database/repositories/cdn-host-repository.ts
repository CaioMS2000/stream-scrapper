import type { CdnHostRepository } from '@/application/repositories'
import type { DrizzleClient } from '@/lib/drizzle'
import { cdnHostTable } from '../schemas'

export type CdnHostRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleCdnHostRepository implements CdnHostRepository {
	constructor(private readonly props: CdnHostRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async listHosts(): Promise<string[]> {
		const records = this.drizzle
			.select({ host: cdnHostTable.host })
			.from(cdnHostTable)
			.all()
		return records.map(r => r.host)
	}

	async recordHost(host: string): Promise<void> {
		await this.drizzle
			.insert(cdnHostTable)
			.values({ host })
			.onConflictDoNothing({ target: cdnHostTable.host })
	}
}
