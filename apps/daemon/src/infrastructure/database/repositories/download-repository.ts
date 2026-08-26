import { eq } from 'drizzle-orm'
import type { DownloadModel } from '@/application/models'
import type {
	CreateDownloadParams,
	DownloadRepository,
	UpdateDownloadParams,
} from '@/application/repositories'
import type { DrizzleClient } from '@/lib/drizzle'
import { downloadTable } from '../schemas'

export type DownloadRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleDownloadRepository implements DownloadRepository {
	constructor(private readonly props: DownloadRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async createDownload(params: CreateDownloadParams): Promise<DownloadModel> {
		const record = this.drizzle
			.insert(downloadTable)
			.values({ ...params, createdAt: new Date() })
			.returning()
			.get()

		return record
	}

	async updateDownloadByStreamId(
		params: UpdateDownloadParams
	): Promise<DownloadModel> {
		const { streamId, ...patch } = params
		const [firstRecord] = await this.drizzle
			.update(downloadTable)
			.set(patch)
			.where(eq(downloadTable.streamId, streamId))
			.returning()

		if (!firstRecord) {
			throw new Error(
				`PANIC! Download with streamId ${streamId} failed to update!`
			)
		}

		return firstRecord
	}

	async findDownloadByStreamId(
		streamId: string
	): Promise<DownloadModel | null> {
		const record = this.drizzle
			.select()
			.from(downloadTable)
			.where(eq(downloadTable.streamId, streamId))
			.get()

		return record ?? null
	}

	async listDownloadsByStatus(
		status: DownloadModel['status']
	): Promise<DownloadModel[]> {
		return this.drizzle
			.select()
			.from(downloadTable)
			.where(eq(downloadTable.status, status))
			.all()
	}
}
