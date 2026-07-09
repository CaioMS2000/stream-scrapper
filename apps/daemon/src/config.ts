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

export const config = {
	dataDir,
	databasePath: join(dataDir, 'storage.db'),
} as const
