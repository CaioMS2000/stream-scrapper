import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Pool de hosts de CDN confirmados — harvesting orgânico (ver
// DownloadVodUseCase): toda resolução bem-sucedida via B ou C grava o
// host que funcionou. Seed inicial via migração com os hosts já
// confirmados empiricamente (ver apps/daemon/spikes/FINDINGS.md, seções
// 3, 4 e 6) — substitui a antiga lista estática
// infrastructure/cdn-recovery/host-pool.ts.
export const cdnHostTable = sqliteTable('cdn_host', {
	id: text()
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),
	host: text('host').notNull().unique(),
	discoveredAt: integer('discovered_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
})

export type DrizzleCdnHostModel = typeof cdnHostTable.$inferSelect
