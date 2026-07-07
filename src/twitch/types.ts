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

// Metadata de detecção (o que o monitor colhe no go-live). Distinta do Manifest:
// isto é "quem/quando" (autoritativo p/ o hash da CDN, caminho 2), não "como tocar".
export interface LiveMetadata {
	userId: string // chave estável (login pode mudar; user_id não)
	streamId: string
	startedAt: number // unix s — o mesmo ingrediente do hash da recovery
	title: string | null
	game: string | null
}

// Contrato público — downloader/recorder/monitor acoplam nisto (espelha Store).
export interface Twitch {
	resolveVodManifest(vodId: string): Promise<ResolveResult>
	recoverVodManifest(
		login: string,
		streamId: string,
		startedAt: number
	): Promise<ResolveResult>
	// Caminho 3 (live): token dance com isLive → master do endpoint de canal.
	resolveLiveManifest(login: string): Promise<ResolveResult>
	// Detecção (monitor): metadata da live, ou null se o canal está offline.
	getLiveMetadata(login: string): Promise<LiveMetadata | null>
}
