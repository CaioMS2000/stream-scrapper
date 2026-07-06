// Contratos e tipos de domínio do store (espelham o schema, Arquitetura §5).

export interface Streamer {
	login: string
	display_name: string | null
	monitored_since: number | null
	auto_record: number // 0 | 1
	quality_pref: string
}

export interface Stream {
	stream_id: string
	streamer_login: string
	started_at: number
	title: string | null
	game: string | null
	duration_seconds: number | null
	vod_id: string | null
	cdn_status: string
	last_probed_at: number | null
}

// meta.json auto-descritivo por pasta (Modulo_Store §6): linha da stream + user_id.
export interface StreamMeta extends Stream {
	user_id: string | null
}

// Entradas das ops: só o obrigatório é exigido; a impl aplica os defaults do schema.
export interface StreamerInput {
	login: string
	display_name?: string | null
	monitored_since?: number | null
	auto_record?: number
	quality_pref?: string
}

export interface StreamInput {
	stream_id: string
	streamer_login: string
	started_at: number
	title?: string | null
	game?: string | null
	duration_seconds?: number | null
	vod_id?: string | null
	cdn_status?: string
	last_probed_at?: number | null
}

export type StorageKind = 'recording' | 'vod' | 'meta' | 'segments'

// Contrato público do módulo — a fronteira que os outros módulos acoplam.
// SqliteStore é a implementação; consumidores dependem desta interface.
export interface Store {
	addStreamer(s: StreamerInput): void
	getStreamer(login: string): Streamer | null
	listStreamers(): Streamer[]
	upsertStream(s: StreamInput): void
	getStream(streamId: string): Stream | null
	listStreams(): Stream[]
	reserveStoragePath(streamId: string, kind: StorageKind): string
	writeMeta(streamId: string): Promise<void>
	reindexFromDisk(): Promise<void>
	close(): void
}
