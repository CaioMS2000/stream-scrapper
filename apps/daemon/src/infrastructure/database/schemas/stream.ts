import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const streamTable = sqliteTable('stream', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	streamId: text('stream_id').notNull().unique(),
	channelName: text('channel_name').notNull(),
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	title: text().notNull(),
	category: text(),
	durationSeconds: integer('duration_seconds'),
	vodId: text('vod_id').unique(),
})

export type DrizzleStreamModel = typeof streamTable.$inferSelect
