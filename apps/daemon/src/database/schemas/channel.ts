import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const channelsTable = sqliteTable('channels', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	username: text().notNull().unique(),
	displayName: text('display_name').notNull(),
	profileImageURL: text('profile_image_url'),

	monitoredSince: integer('monitored_since', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),

	autoRecord: integer('auto_record', { mode: 'boolean' })
		.notNull()
		.default(false),

	qualityPref: text('quality_pref', {
		enum: ['best', 'source', '1080p', '720p'],
	}).notNull(),
})

export type ChannelModel = typeof channelsTable.$inferSelect
