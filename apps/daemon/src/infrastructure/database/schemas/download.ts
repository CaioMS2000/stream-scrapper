import { sql } from 'drizzle-orm'
import {
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { DownloadStatus, ResolvedVia } from '@/application/models/types'

export const downloadTable = sqliteTable(
	'download',
	{
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
		endedAt: integer('ended_at', { mode: 'timestamp' }),
		// Material resolvido, persistido pra permitir retomada sem re-resolver
		// (docs/design segments é imutável) — ver
		// past conversations/decisoes-downloader.md §8-10.
		resolvedVia: text('resolved_via', { enum: ResolvedVia }),
		host: text('host'),
		baseUrl: text('base_url'),
		segments: text('segments'), // JSON.stringify(string[])
		// Cursor durável — par, não um contador só (ver §8 do documento acima).
		segmentIndex: integer('segment_index').notNull().default(0),
		byteOffset: integer('byte_offset').notNull().default(0),
		// Renovado a cada `progress` recebido do executor vivo — rede de
		// segurança pro boot scan distinguir órfão real de download saudável
		// quando o daemon inteiro reinicia (§12-13 do documento acima).
		leaseUntil: integer('lease_until', { mode: 'timestamp' }),
	},
	table => [
		// Índice único parcial: no máximo um download ativo (queued/downloading)
		// por streamId. Permite retry após 'failed'/'completed'. Necessário
		// porque, diferente do StartRecordingUseCase (Monitor sequencial), os
		// gatilhos de download (comando manual, futuro job de descoberta) não
		// são garantidamente sequenciais — ver docs/design/002-download-de-vods.md
		// Risco #4.
		uniqueIndex('download_active_stream_idx')
			.on(table.streamId)
			.where(sql`${table.status} in ('queued', 'downloading')`),
	]
)

export type DrizzleDownloadModel = typeof downloadTable.$inferSelect
