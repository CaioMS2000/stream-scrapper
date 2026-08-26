import { createWriteStream, mkdirSync } from 'node:fs'
import { encodeMessage, LineBuffer } from '@repo/ipc'
import { MaterialMessage } from './protocol'

// Entrypoint de child process pro download de um VOD — spawnado pelo
// dispatcher (infrastructure/downloader) via `Bun.spawn`. Executor "burro":
// não toca o banco, só recebe material pela stdin e reporta pela stdout
// (protocolo em ./protocol.ts). Ver
// past conversations/decisoes-downloader.md §9 e §11.
//
// Migrado quase inalterado de HttpVodDownloader.downloadSegmentsInOrder —
// mesmo algoritmo de pool com buffer de reordenação, mesma escrita
// estritamente sequencial — só que agora abre em append a partir de
// `segmentsFrom`/`byteOffsetFrom` em vez de sempre do zero.

const SEGMENT_RETRY_ATTEMPTS = 3
const SEGMENT_RETRY_BASE_DELAY_MS = 500
const PROGRESS_UPDATE_EVERY_N_SEGMENTS = 10

function send(message: unknown) {
	process.stdout.write(encodeMessage(message))
}

// Resolve na primeira `material` recebida; chamadas seguintes (resposta a
// `need-material`) resolvem o waiter mais antigo na fila.
const { promise: firstMaterial, resolve: resolveFirstMaterial } =
	Promise.withResolvers<MaterialMessage>()
let gotFirst = false
const materialWaiters: Array<(material: MaterialMessage) => void> = []

function waitForMaterial(): Promise<MaterialMessage> {
	return new Promise(resolve => materialWaiters.push(resolve))
}

async function readStdinMessages() {
	const lineBuffer = new LineBuffer()
	const decoder = new TextDecoder()
	for await (const chunk of Bun.stdin.stream()) {
		const lines = lineBuffer.push(decoder.decode(chunk, { stream: true }))
		for (const line of lines) {
			const material = MaterialMessage.parse(JSON.parse(line))
			if (!gotFirst) {
				gotFirst = true
				resolveFirstMaterial(material)
			} else {
				materialWaiters.shift()?.(material)
			}
		}
	}
}

async function fetchSegmentWithRetry(url: string): Promise<Uint8Array> {
	let lastError: unknown

	for (let attempt = 1; attempt <= SEGMENT_RETRY_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url)
			if (response.status === 401 || response.status === 403) {
				// Sinaliza tipo específico — o loop principal decide pedir
				// `need-material` em vez de só tentar de novo (ver ./protocol.ts,
				// esperado ficar dormente na prática).
				throw new AuthExpiredError(url)
			}
			if (!response.ok) {
				throw new Error(`segment fetch failed: ${response.status} ${url}`)
			}
			return new Uint8Array(await response.arrayBuffer())
		} catch (error) {
			if (error instanceof AuthExpiredError) throw error
			lastError = error
			if (attempt < SEGMENT_RETRY_ATTEMPTS) {
				await Bun.sleep(SEGMENT_RETRY_BASE_DELAY_MS * attempt)
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

class AuthExpiredError extends Error {
	constructor(url: string) {
		super(`segment fetch unauthorized (401/403): ${url}`)
		this.name = 'AuthExpiredError'
	}
}

async function run(material: MaterialMessage): Promise<void> {
	const { jobId, destinationPath, segmentsFrom, byteOffsetFrom } = material
	let { baseUrl, segments } = material

	// `destinationPath` é a PASTA (mesma convenção de
	// MediaStorage.createStreamPath) — o arquivo final é sempre
	// `stream.ts` dentro dela, igual à gravação ao vivo.
	mkdirSync(destinationPath, { recursive: true })
	const outputPath = `${destinationPath}/stream.ts`
	const stream = createWriteStream(outputPath, {
		flags: segmentsFrom > 0 ? 'a' : 'w',
	})

	const pending = new Map<number, Uint8Array>()
	let nextToWrite = segmentsFrom
	let nextToFetch = segmentsFrom
	let totalBytes = byteOffsetFrom
	let written = segmentsFrom

	const drain = () => {
		while (pending.has(nextToWrite)) {
			const chunk = pending.get(nextToWrite)
			if (!chunk) break
			pending.delete(nextToWrite)
			stream.write(chunk)
			totalBytes += chunk.byteLength
			nextToWrite++
			written++

			if (
				written % PROGRESS_UPDATE_EVERY_N_SEGMENTS === 0 ||
				written === segments.length
			) {
				send({
					type: 'progress',
					jobId,
					segmentIndex: written,
					byteOffset: totalBytes,
				})
			}
		}
	}

	const worker = async () => {
		while (true) {
			const index = nextToFetch++
			if (index >= segments.length) return

			const segmentUrl = `${baseUrl}/${segments[index]}`
			try {
				const bytes = await fetchSegmentWithRetry(segmentUrl)
				pending.set(index, bytes)
				drain()
			} catch (error) {
				if (error instanceof AuthExpiredError) {
					// Pede material fresco a partir do próprio índice deste worker
					// (não de `nextToWrite` — outros workers podem estar mais
					// adiantados) e continua com o que voltar.
					send({ type: 'need-material', jobId, fromSegment: index })
					const fresh = await waitForMaterial()
					baseUrl = fresh.baseUrl
					segments = fresh.segments
					nextToFetch = index
					continue
				}
				throw error
			}
		}
	}

	const concurrency = Math.max(1, material.segmentConcurrency)
	const workerCount = Math.min(concurrency, segments.length - segmentsFrom)
	await Promise.all(
		Array.from({ length: Math.max(workerCount, 0) }, () => worker())
	)

	await new Promise<void>((resolve, reject) => {
		stream.end((err: Error | null | undefined) =>
			err ? reject(err) : resolve()
		)
	})

	send({ type: 'done', jobId })
}

async function main() {
	void readStdinMessages()
	const material = await firstMaterial

	try {
		await run(material)
		process.exit(0)
	} catch (error) {
		send({
			type: 'failed',
			jobId: material.jobId,
			error: error instanceof Error ? error.message : String(error),
		})
		process.exit(1)
	}
}

await main()
