import { eq } from 'drizzle-orm'
import type { DrizzleClient } from '@/lib/drizzle'
import type { StreamModel } from '@/models'
import type {
	CreateStreamParams,
	GetStreamParams,
	StreamRepository,
} from '@/repositories'
import { streamTable } from '../schemas'

export type StreamRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleStreamRepository implements StreamRepository {
	constructor(private readonly props: StreamRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async createStream(params: CreateStreamParams): Promise<StreamModel> {
		const { channelName, startedAt, title, category, streamId } = params
		const record = this.drizzle
			.insert(streamTable)
			.values({
				channelName,
				startedAt,
				title,
				category,
				streamId,
			})
			.returning()
			.get()

		return record
	}

	async getStream(params: GetStreamParams): Promise<StreamModel> {
		const whereQuery = this.drizzle.select().from(streamTable).where
		let record: StreamModel | undefined

		if ('streamId' in params) {
			record = whereQuery(eq(streamTable.streamId, params.streamId)).get()
		} else if ('id' in params) {
			record = whereQuery(eq(streamTable.id, params.id)).get()
		}

		if (!record) {
			throw new Error(
				'PANIC!!! getStream params must contain either streamId or id'
			)
		}

		return record
	}
}
