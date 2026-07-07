import { Database, type Statement } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { StoragePaths } from './paths.ts'
import { SCHEMA_SQL } from './schema.ts'
import type {
	Download,
	DownloadPatch,
	DownloadSource,
	Recording,
	RecordingPatch,
	StorageKind,
	Store,
	Stream,
	Streamer,
	StreamerInput,
	StreamInput,
	StreamMeta,
} from './types.ts'

// Fundação de persistência. Único dono do SQLite + do layout em disco: ninguém
// mais toca SQL nem monta caminho. Disco é a verdade, banco é índice
// reconstruível (Modulo_Store §4). Injeção por construtor (root); zero container.
export class SqliteStore implements Store {
	private readonly db: Database
	private readonly paths: StoragePaths

	// statements preparados: todo o SQL fica confinado nesta classe
	private readonly stmtUpsertStreamer: Statement
	private readonly stmtGetStreamer: Statement
	private readonly stmtListStreamers: Statement
	private readonly stmtUpsertStream: Statement
	private readonly stmtGetStream: Statement
	private readonly stmtListStreams: Statement
	private readonly stmtCreateDownload: Statement
	private readonly stmtUpdateDownload: Statement
	private readonly stmtGetDownload: Statement
	private readonly stmtListDownloads: Statement
	private readonly stmtCreateRecording: Statement
	private readonly stmtUpdateRecording: Statement
	private readonly stmtGetRecording: Statement
	private readonly stmtListRecordings: Statement

	constructor(root: string) {
		// bun:sqlite cria o ARQUIVO, mas não a pasta pai → garante o root primeiro.
		mkdirSync(root, { recursive: true })
		this.db = new Database(join(root, 'archive.db'), { create: true })
		this.db.exec('PRAGMA journal_mode = WAL')
		this.db.exec(SCHEMA_SQL)
		this.paths = new StoragePaths(root)

		this.stmtUpsertStreamer = this.db.query(`
			INSERT INTO streamers (login, display_name, monitored_since, auto_record, quality_pref)
			VALUES ($login, $display_name, $monitored_since, $auto_record, $quality_pref)
			ON CONFLICT(login) DO UPDATE SET
				display_name = excluded.display_name,
				monitored_since = excluded.monitored_since,
				auto_record = excluded.auto_record,
				quality_pref = excluded.quality_pref
		`)
		this.stmtGetStreamer = this.db.query(
			'SELECT * FROM streamers WHERE login = $login'
		)
		this.stmtListStreamers = this.db.query(
			'SELECT * FROM streamers ORDER BY login'
		)
		this.stmtUpsertStream = this.db.query(`
			INSERT INTO streams (stream_id, streamer_login, started_at, title, game, duration_seconds, vod_id, cdn_status, last_probed_at)
			VALUES ($stream_id, $streamer_login, $started_at, $title, $game, $duration_seconds, $vod_id, $cdn_status, $last_probed_at)
			ON CONFLICT(stream_id) DO UPDATE SET
				streamer_login = excluded.streamer_login,
				started_at = excluded.started_at,
				title = excluded.title,
				game = excluded.game,
				duration_seconds = excluded.duration_seconds,
				vod_id = excluded.vod_id,
				cdn_status = excluded.cdn_status,
				last_probed_at = excluded.last_probed_at
		`)
		this.stmtGetStream = this.db.query(
			'SELECT * FROM streams WHERE stream_id = $stream_id'
		)
		this.stmtListStreams = this.db.query(
			'SELECT * FROM streams ORDER BY started_at'
		)
		this.stmtCreateDownload = this.db.query(`
			INSERT INTO downloads (id, stream_id, source, status, progress, storage_path, created_at)
			VALUES ($id, $stream_id, $source, $status, $progress, $storage_path, $created_at)
		`)
		this.stmtUpdateDownload = this.db.query(`
			UPDATE downloads SET status = $status, progress = $progress, storage_path = $storage_path
			WHERE id = $id
		`)
		this.stmtGetDownload = this.db.query(
			'SELECT * FROM downloads WHERE id = $id'
		)
		this.stmtListDownloads = this.db.query(
			'SELECT * FROM downloads ORDER BY created_at'
		)
		this.stmtCreateRecording = this.db.query(`
			INSERT INTO recordings (id, stream_id, started_at, ended_at, status, quality, storage_path, bytes)
			VALUES ($id, $stream_id, $started_at, $ended_at, $status, $quality, $storage_path, $bytes)
		`)
		this.stmtUpdateRecording = this.db.query(`
			UPDATE recordings SET status = $status, ended_at = $ended_at, storage_path = $storage_path, bytes = $bytes
			WHERE id = $id
		`)
		this.stmtGetRecording = this.db.query(
			'SELECT * FROM recordings WHERE id = $id'
		)
		this.stmtListRecordings = this.db.query(
			'SELECT * FROM recordings ORDER BY started_at'
		)
	}

	// input → bind object completo (aplica os defaults do schema)
	private streamerBind(s: StreamerInput) {
		return {
			$login: s.login,
			$display_name: s.display_name ?? null,
			$monitored_since: s.monitored_since ?? null,
			$auto_record: s.auto_record ?? 0,
			$quality_pref: s.quality_pref ?? 'best',
		}
	}
	private streamBind(s: StreamInput) {
		return {
			$stream_id: s.stream_id,
			$streamer_login: s.streamer_login,
			$started_at: s.started_at,
			$title: s.title ?? null,
			$game: s.game ?? null,
			$duration_seconds: s.duration_seconds ?? null,
			$vod_id: s.vod_id ?? null,
			$cdn_status: s.cdn_status ?? 'unknown',
			$last_probed_at: s.last_probed_at ?? null,
		}
	}

	addStreamer(s: StreamerInput): void {
		this.stmtUpsertStreamer.run(this.streamerBind(s))
	}
	getStreamer(login: string): Streamer | null {
		return this.stmtGetStreamer.get({ $login: login }) as Streamer | null
	}
	listStreamers(): Streamer[] {
		return this.stmtListStreamers.all() as Streamer[]
	}
	upsertStream(s: StreamInput): void {
		this.stmtUpsertStream.run(this.streamBind(s))
	}
	getStream(streamId: string): Stream | null {
		return this.stmtGetStream.get({ $stream_id: streamId }) as Stream | null
	}
	listStreams(): Stream[] {
		return this.stmtListStreams.all() as Stream[]
	}

	reserveStoragePath(streamId: string, kind: StorageKind): string {
		const stream = this.getStream(streamId)
		if (!stream) throw new Error(`stream ${streamId} não existe no índice`)
		return this.paths.reserveStoragePath(stream, kind)
	}

	async writeMeta(streamId: string): Promise<void> {
		const stream = this.getStream(streamId)
		if (!stream) throw new Error(`stream ${streamId} não existe no índice`)
		const meta: StreamMeta = { ...stream, user_id: null }
		await this.paths.writeMeta(meta)
	}

	async reindexFromDisk(): Promise<void> {
		const files = await this.paths.scanMetaFiles()
		const metas = await Promise.all(files.map(f => this.paths.readMeta(f)))
		// Escopo honesto: o ACERVO (streams) volta completo do meta.json; a CONFIG
		// de streamer (auto_record, quality_pref) não é acervo → re-criada mínima
		// (só login) só pra satisfazer a referência.
		this.db.transaction((rows: StreamMeta[]) => {
			for (const m of rows) {
				this.stmtUpsertStreamer.run(
					this.streamerBind({ login: m.streamer_login })
				)
				this.stmtUpsertStream.run(this.streamBind(m))
			}
		})(metas)
	}

	// --- downloads (caminhos 1/2) ---
	createDownload(streamId: string, source: DownloadSource): Download {
		const download: Download = {
			id: crypto.randomUUID(),
			stream_id: streamId,
			source,
			status: 'queued',
			progress: 0,
			storage_path: null,
			created_at: Math.floor(Date.now() / 1000),
		}
		this.stmtCreateDownload.run({
			$id: download.id,
			$stream_id: download.stream_id,
			$source: download.source,
			$status: download.status,
			$progress: download.progress,
			$storage_path: download.storage_path,
			$created_at: download.created_at,
		})
		return download
	}

	updateDownload(id: string, patch: DownloadPatch): void {
		const cur = this.getDownload(id)
		if (!cur) throw new Error(`download ${id} não existe`)
		this.stmtUpdateDownload.run({
			$id: id,
			$status: patch.status ?? cur.status,
			$progress: patch.progress ?? cur.progress,
			$storage_path: patch.storage_path ?? cur.storage_path,
		})
	}

	getDownload(id: string): Download | null {
		return this.stmtGetDownload.get({ $id: id }) as Download | null
	}

	listDownloads(): Download[] {
		return this.stmtListDownloads.all() as Download[]
	}

	// --- recordings (caminho 3) ---
	createRecording(streamId: string, quality: string): Recording {
		const recording: Recording = {
			id: crypto.randomUUID(),
			stream_id: streamId,
			started_at: Math.floor(Date.now() / 1000),
			ended_at: null,
			status: 'recording',
			quality,
			storage_path: null,
			bytes: null,
		}
		this.stmtCreateRecording.run({
			$id: recording.id,
			$stream_id: recording.stream_id,
			$started_at: recording.started_at,
			$ended_at: recording.ended_at,
			$status: recording.status,
			$quality: recording.quality,
			$storage_path: recording.storage_path,
			$bytes: recording.bytes,
		})
		return recording
	}

	updateRecording(id: string, patch: RecordingPatch): void {
		const cur = this.getRecording(id)
		if (!cur) throw new Error(`recording ${id} não existe`)
		this.stmtUpdateRecording.run({
			$id: id,
			$status: patch.status ?? cur.status,
			$ended_at: patch.ended_at ?? cur.ended_at,
			$storage_path: patch.storage_path ?? cur.storage_path,
			$bytes: patch.bytes ?? cur.bytes,
		})
	}

	getRecording(id: string): Recording | null {
		return this.stmtGetRecording.get({ $id: id }) as Recording | null
	}

	listRecordings(): Recording[] {
		return this.stmtListRecordings.all() as Recording[]
	}

	close(): void {
		this.db.close()
	}
}
