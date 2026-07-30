import { join, resolve } from 'node:path'
import { env } from './env'

// Raiz de dados da aplicação: o banco (storage.db) e os vídeos baixados
// futuramente vivem aqui embaixo.
//
// Default determinístico e independente do cwd — ancorado na pasta `data/` do
// próprio app (via import.meta.dir), então roda out-of-the-box sem configurar
// nada. Sobrescrevível por env pra apontar, por exemplo, pra um HD separado:
//   STREAM_SCRAPPER_DATA_DIR=/mnt/hd/streams
const dataDir = env.STREAM_SCRAPPER_DATA_DIR
	? resolve(env.STREAM_SCRAPPER_DATA_DIR)
	: resolve(import.meta.dir, '..', 'data')

// Binário do streamlink usado pra gravar as lives. Default aponta pro venv
// gerado por `bun run setup` (apps/daemon/venv/bin/streamlink). Em VPS/container
// dá pra apontar pra um streamlink do sistema sem rodar o setup:
//   STREAM_SCRAPPER_STREAMLINK_BIN=/usr/bin/streamlink
const streamlinkBinPath = env.STREAM_SCRAPPER_STREAMLINK_BIN
	? resolve(env.STREAM_SCRAPPER_STREAMLINK_BIN)
	: resolve(import.meta.dir, '..', 'venv', 'bin', 'streamlink')

// ffmpeg + ffprobe pro futuro rewrap .ts → .mp4 (roadmap). Default aponta pros
// binários estáticos baixados por `bun run setup` (apps/daemon/bin/). Override
// via env pra apontar pra binários do sistema:
//   STREAM_SCRAPPER_FFMPEG_BIN=/usr/bin/ffmpeg
//   STREAM_SCRAPPER_FFPROBE_BIN=/usr/bin/ffprobe
const ffmpegBinPath = env.STREAM_SCRAPPER_FFMPEG_BIN
	? resolve(env.STREAM_SCRAPPER_FFMPEG_BIN)
	: resolve(import.meta.dir, '..', 'bin', 'ffmpeg')

const ffprobeBinPath = env.STREAM_SCRAPPER_FFPROBE_BIN
	? resolve(env.STREAM_SCRAPPER_FFPROBE_BIN)
	: resolve(import.meta.dir, '..', 'bin', 'ffprobe')

export const config = {
	dataDir,
	databasePath: join(dataDir, 'storage.db'),
	streamlinkBinPath,
	ffmpegBinPath,
	ffprobeBinPath,
} as const
