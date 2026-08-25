import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Canais de terceiros pra harvesting ativo de hosts de CDN (ver
// HarvestCdnHostsUseCase/CdnHostHarvester) — gerenciados via CLI
// (add/remove/list-harvest-channels), sem descoberta automática (ADR 005).
// Substitui a antiga lista estática
// infrastructure/cdn-host-harvester/channel-list.ts (removida). Ao
// contrário de cdn_host, a tabela nasce vazia — sem seed.
export const harvestChannelTable = sqliteTable('harvest_channel', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	channelName: text('channel_name').notNull().unique(),
	addedAt: integer('added_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
})

export type DrizzleHarvestChannelModel = typeof harvestChannelTable.$inferSelect
