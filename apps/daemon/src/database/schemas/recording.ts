import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const recordingTable = sqliteTable('recording', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	streamId: text('stream_id').notNull(),
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	endedAt: integer('ended_at', { mode: 'timestamp' }).notNull(),
	status: text('status').notNull(),
	quality: text('quality', {
		enum: ['best', 'source', '1080p', '720p'],
	}).notNull(),
	storagePath: text('storage_path').notNull(),
	bytes: integer('bytes').notNull(), // o tamanho em bytes do .mp4 final
})

export type RecordingModel = typeof recordingTable.$inferSelect
