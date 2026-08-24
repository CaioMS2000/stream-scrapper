import { eq } from 'drizzle-orm'
import type { RecordingModel } from '@/application/models'
import type {
	CreateRecordingParams,
	RecordingRepository,
	UpdateRecordingParams,
} from '@/application/repositories'
import type { DrizzleClient } from '@/lib/drizzle'
import { recordingTable } from '../schemas'

export type RecordingRepositoryProps = {
	drizzle: DrizzleClient
}

export class DrizzleRecordingRepository implements RecordingRepository {
	constructor(private readonly props: RecordingRepositoryProps) {}

	private get drizzle() {
		return this.props.drizzle
	}

	async createRecording(
		params: CreateRecordingParams
	): Promise<RecordingModel> {
		const record = this.drizzle
			.insert(recordingTable)
			.values(params)
			.returning()
			.get()

		return record
	}

	async updateRecordingByStreamId(
		params: UpdateRecordingParams
	): Promise<RecordingModel> {
		const { streamId, ...patch } = params
		const [firstRecord] = await this.drizzle
			.update(recordingTable)
			.set(patch)
			.where(eq(recordingTable.streamId, streamId))
			.returning()

		if (!firstRecord) {
			throw new Error(
				`PANIC! Recording with streamId ${streamId} failed to update!`
			)
		}

		return firstRecord
	}

	async findRecordingByStreamId(
		streamId: string
	): Promise<RecordingModel | null> {
		const record = this.drizzle
			.select()
			.from(recordingTable)
			.where(eq(recordingTable.streamId, streamId))
			.get()

		return record ?? null
	}
}
