import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageKind, Stream, StreamMeta } from './types.ts'

const FILENAME: Record<StorageKind, string> = {
	recording: 'recording.mp4',
	vod: 'vod.mp4',
	meta: 'meta.json',
	segments: 'segments',
}

// Único dono do layout em disco (Modulo_Store §6):
//   <root>/<login>/<streamId>_<startedAt>/{meta.json, recording.mp4, vod.mp4, segments/}
// login na pasta (humano-navegável); user_id fica no meta.json (estável).
// Recebe o root por construtor (injeção) — sem estado global.
export class StoragePaths {
	constructor(private readonly root: string) {}

	streamDir(stream: Stream): string {
		return join(
			this.root,
			stream.streamer_login,
			`${stream.stream_id}_${stream.started_at}`
		)
	}

	// Cria a pasta da stream (mkdir -p) e devolve o caminho do arquivo pedido.
	reserveStoragePath(stream: Stream, kind: StorageKind): string {
		const dir = this.streamDir(stream)
		mkdirSync(dir, { recursive: true })
		return join(dir, FILENAME[kind])
	}

	// Grava o meta.json auto-descritivo (a linha completa da stream + user_id).
	// É a âncora de resiliência: com ele, o índice é reconstruível a partir do disco.
	async writeMeta(meta: StreamMeta): Promise<void> {
		const dir = this.streamDir(meta)
		mkdirSync(dir, { recursive: true })
		await Bun.write(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
	}

	// Lista todos os meta.json do acervo (varredura da árvore).
	async scanMetaFiles(): Promise<string[]> {
		const glob = new Bun.Glob('*/*/meta.json')
		const files: string[] = []
		for await (const rel of glob.scan({ cwd: this.root })) {
			files.push(join(this.root, rel))
		}
		return files
	}

	async readMeta(path: string): Promise<StreamMeta> {
		return (await Bun.file(path).json()) as StreamMeta
	}
}
