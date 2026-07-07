import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const streamTable = sqliteTable('stream', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	streamerLogin: text('streamer_login').notNull(),
	startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
	title: text().notNull(),
	game: text().notNull(),
	durationSeconds: integer('duration_seconds').notNull(),
	vodId: text('vod_id').notNull(),
	cdnStatus: text('cdn_status').notNull(),
	lastProbedAt: integer('last_probed_at', { mode: 'timestamp' }).notNull(),
})

export type StreamModel = typeof streamTable.$inferSelect
