import { sql } from 'drizzle-orm'
import {
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { DownloadStatus } from '@/application/models/types'

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
