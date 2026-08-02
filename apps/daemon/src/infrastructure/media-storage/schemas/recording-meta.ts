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
	quality: z.enum(VideoQuality),
	status: z.enum(RecordingStatus),
	bytes: z.int().optional(),
})
export const recordingMetaFileSchema = z.discriminatedUnion(
	'meta_schema_version',
	[recordingMetaFileSchemav1]
)
export type RecordingMetaFile = z.infer<typeof recordingMetaFileSchema>
