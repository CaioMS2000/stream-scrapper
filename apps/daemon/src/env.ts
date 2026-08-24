import z from 'zod'

// STREAM_SCRAPPER_SOCKET também afeta o daemon, mas é consumido dentro
// do @repo/ipc (packages/ipc/src/socket-path.ts) — não passa por aqui.

const envSchema = z.object({
	STREAM_SCRAPPER_DATA_DIR: z.string().optional(),
	STREAM_SCRAPPER_STREAMLINK_BIN: z.string().optional(),
	STREAM_SCRAPPER_FFMPEG_BIN: z.string().optional(),
	STREAM_SCRAPPER_FFPROBE_BIN: z.string().optional(),
	STREAM_SCRAPPER_MAX_CONCURRENT_DOWNLOADS: z.coerce.number().optional(),
	STREAM_SCRAPPER_DOWNLOAD_SEGMENT_CONCURRENCY: z.coerce.number().optional(),
})

export const env = envSchema.parse(process.env)
