import z from 'zod'
import { RecordingStatus, VideoQuality } from '@/application/models/types'

export const CURRENT_RECORDING_META_SCHEMA_VERSION = 1
export const recordingMetaFileSchemav1 = z.object({
	meta_schema_version: z.literal(1),
	streamId: z.string(),
	channelName: z.string(),
	title: z.string(),
	// coerce.date() aceita string ISO (JSON.parse) e Date nativo — necessário
	// pra hidratar quando lemos o meta.json de volta pra update.
	startedAt: z.coerce.date(),
	endedAt: z.coerce.date().optional(),
	// Ausentes enquanto a stream não tem gravação decidida — todo `stream`
	// ganha meta.json mínimo (ver ChannelMonitor), independente de auto-record.
	quality: z.enum(VideoQuality).optional(),
	status: z.enum(RecordingStatus).optional(),
	bytes: z.int().optional(),
})
export const recordingMetaFileSchema = z.discriminatedUnion(
	'meta_schema_version',
	[recordingMetaFileSchemav1]
)
export type RecordingMetaFile = z.infer<typeof recordingMetaFileSchema>
