// Schema do índice (Arquitetura §5). Idempotente (IF NOT EXISTS) — faz as vezes
// de migration mínima no MVP; um schema_version + migrations vem depois (§9).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS streamers (
	login            TEXT PRIMARY KEY,
	display_name     TEXT,
	monitored_since  INTEGER,
	auto_record      INTEGER DEFAULT 0,
	quality_pref     TEXT DEFAULT 'best'
);

CREATE TABLE IF NOT EXISTS streams (
	stream_id        TEXT PRIMARY KEY,
	streamer_login   TEXT REFERENCES streamers(login),
	started_at       INTEGER,
	title            TEXT,
	game             TEXT,
	duration_seconds INTEGER,
	vod_id           TEXT,
	cdn_status       TEXT DEFAULT 'unknown',
	last_probed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS recordings (
	id           TEXT PRIMARY KEY,
	stream_id    TEXT REFERENCES streams(stream_id),
	started_at   INTEGER,
	ended_at     INTEGER,
	status       TEXT,
	quality      TEXT,
	storage_path TEXT,
	bytes        INTEGER
);

CREATE TABLE IF NOT EXISTS downloads (
	id           TEXT PRIMARY KEY,
	stream_id    TEXT REFERENCES streams(stream_id),
	source       TEXT,
	status       TEXT,
	progress     REAL DEFAULT 0,
	storage_path TEXT,
	created_at   INTEGER
);
`
