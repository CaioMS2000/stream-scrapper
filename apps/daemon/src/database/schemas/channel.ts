import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { StreamQuality } from '@/models/types'

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

	isLive: integer('is_live', { mode: 'boolean' }).notNull().default(false),

	qualityPref: text('quality_pref', {
		enum: StreamQuality,
	}).notNull(),
})

export type DrizzleChannelModel = typeof channelsTable.$inferSelect
