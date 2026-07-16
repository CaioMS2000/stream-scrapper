import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { DownloadStatus } from '@/application/models/types'

export const downloadTable = sqliteTable('download', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	streamId: text('stream_id').notNull(),
	status: text('status', {
		enum: DownloadStatus,
	}).notNull(),
	progress: real('progress'),
	storagePath: text('storage_path').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export type DrizzleDownloadModel = typeof downloadTable.$inferSelect
