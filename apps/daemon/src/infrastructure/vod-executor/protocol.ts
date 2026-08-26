import z from 'zod'

// Protocolo pai↔executor pro download de VOD como child process — NDJSON
// pela stdin/stdout do child, reaproveitando o framing genérico de
// @repo/ipc (LineBuffer/encodeMessage), mas com schema próprio: não é o
// mesmo protocolo CLI↔daemon (consumidores diferentes). Ver
// past conversations/decisoes-downloader.md §11 (contrato de 5 mensagens)
// e docs/design/002-download-de-vods.md.

// --- Executor → pai ---------------------------------------------------

// Periódico; carrega o par que vira o cursor durável no banco. Duplo
// propósito: avança o cursor E renova o `leaseUntil` no mesmo write.
export const ProgressMessage = z.object({
	type: z.literal('progress'),
	jobId: z.string(),
	segmentIndex: z.number(),
	byteOffset: z.number(),
})
export type ProgressMessage = z.infer<typeof ProgressMessage>

// "Meu material não serve mais, estou no N, me devolve o que preciso a
// partir de N." Idempotente por natureza — é leitura/derive, não avança
// estado. Esperado ficar dormente na prática (ver nota no design doc:
// segments não parecem exigir auth depois de resolvidos).
export const NeedMaterialMessage = z.object({
	type: z.literal('need-material'),
	jobId: z.string(),
	fromSegment: z.number(),
})
export type NeedMaterialMessage = z.infer<typeof NeedMaterialMessage>

export const DoneMessage = z.object({
	type: z.literal('done'),
	jobId: z.string(),
})
export type DoneMessage = z.infer<typeof DoneMessage>

export const FailedMessage = z.object({
	type: z.literal('failed'),
	jobId: z.string(),
	error: z.string(),
})
export type FailedMessage = z.infer<typeof FailedMessage>

export const ExecutorMessage = z.discriminatedUnion('type', [
	ProgressMessage,
	NeedMaterialMessage,
	DoneMessage,
	FailedMessage,
])
export type ExecutorMessage = z.infer<typeof ExecutorMessage>

// --- Pai → executor -----------------------------------------------------

// Mandada uma vez no spawn (primeira mensagem na stdin) e de novo se
// `need-material` chegar — nesse caso reenvia o que já está persistido no
// banco, sem re-resolver (ver nota no design doc).
export const MaterialMessage = z.object({
	type: z.literal('material'),
	jobId: z.string(),
	host: z.string(),
	baseUrl: z.string(),
	segments: z.array(z.string()),
	// A partir de qual índice o executor deve continuar buscando —
	// `download.segmentIndex` persistido, 0 num download novo.
	segmentsFrom: z.number(),
	// Bytes já confirmados em disco antes desse ponto (`download.byteOffset`)
	// — semente do contador cumulativo do executor, pra `progress.byteOffset`
	// continuar reportando o offset ABSOLUTO no arquivo, não só bytes desta
	// sessão. 0 num download novo.
	byteOffsetFrom: z.number(),
	// PASTA de destino (mesma convenção de MediaStorage.createStreamPath) —
	// o arquivo final é sempre `stream.ts` dentro dela.
	destinationPath: z.string(),
	// Fetches de segments em paralelo — config do daemon
	// (STREAM_SCRAPPER_DOWNLOAD_SEGMENT_CONCURRENCY), repassada porque o
	// executor não lê env/config próprio (só recebe o que o pai manda).
	segmentConcurrency: z.number(),
})
export type MaterialMessage = z.infer<typeof MaterialMessage>
