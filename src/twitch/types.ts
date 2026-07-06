// Tipos do módulo twitch. O move central (Modulo_Twitch §1/§3): os resolvers
// devolvem o MESMO Manifest normalizado — a rota de aquisição some downstream.

export interface QualityVariant {
	name: string // 'chunked' (=source), '720p30', '1080p60'…
	bandwidth: number
	resolution: string // '1920x1080' ou '' (recovery/audio)
	mediaPlaylistUrl: string
}

export type ManifestSource = 'authenticated' | 'cdn-recovery'

export interface AuthContext {
	clientId: string
	cookies?: string // caminho 1 autenticado (deferido)
	headers?: Record<string, string> // ex.: Client-Integrity (deferido)
}

export interface Manifest {
	source: ManifestSource
	variants: QualityVariant[]
	authContext: AuthContext
	muted: boolean // detecção de -muted deferida (sempre false por ora)
}

// Desfechos distintos importam: é o que deixa o resolver (§5, glue futuro fora
// do módulo) decidir o próximo caminho sem adivinhação.
export type ResolveError = 'forbidden' | 'not-found' | 'not-on-cdn'

export type ResolveResult =
	| { ok: true; manifest: Manifest }
	| { ok: false; error: ResolveError }

// Contrato público — o downloader acopla nisto (espelha Store/SqliteStore).
export interface Twitch {
	resolveVodManifest(vodId: string): Promise<ResolveResult>
	recoverVodManifest(
		login: string,
		streamId: string,
		startedAt: number
	): Promise<ResolveResult>
}
