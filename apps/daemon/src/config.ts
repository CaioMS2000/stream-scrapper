import { join, resolve } from 'node:path'

// Raiz de dados da aplicação: o banco (storage.db) e os vídeos baixados
// futuramente vivem aqui embaixo.
//
// Default determinístico e independente do cwd — ancorado na pasta `data/` do
// próprio app (via import.meta.dir), então roda out-of-the-box sem configurar
// nada. Sobrescrevível por env pra apontar, por exemplo, pra um HD separado:
//   STREAM_SCRAPPER_DATA_DIR=/mnt/hd/streams
const dataDir = process.env.STREAM_SCRAPPER_DATA_DIR
	? resolve(process.env.STREAM_SCRAPPER_DATA_DIR)
	: resolve(import.meta.dir, '..', 'data')

// Binário do streamlink usado pra gravar as lives. Default aponta pro AppImage
// versionado em `bin/streamlink/AppRun` (funciona out-of-the-box). Em VPS/container
// dá pra apontar pra um streamlink instalado pelo sistema sem tocar código:
//   STREAM_SCRAPPER_STREAMLINK_BIN=/usr/bin/streamlink
const streamlinkBinPath = process.env.STREAM_SCRAPPER_STREAMLINK_BIN
	? resolve(process.env.STREAM_SCRAPPER_STREAMLINK_BIN)
	: resolve(import.meta.dir, '..', 'bin', 'streamlink', 'AppRun')

export const config = {
	dataDir,
	databasePath: join(dataDir, 'storage.db'),
	streamlinkBinPath,
} as const
