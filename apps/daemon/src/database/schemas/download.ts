import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const downloadTable = sqliteTable('download', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	streamId: text('stream_id').notNull(),
	source: text('source').notNull(),
	status: text('status', {
		enum: ['queued', 'downloading', 'completed', 'failed'],
	}).notNull(),
	progress: text('progress').notNull(),
	storagePath: text('storage_path').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export type DownloadModel = typeof downloadTable.$inferSelect
