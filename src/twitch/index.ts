// Barrel do módulo twitch: a superfície pública que os outros módulos importam.
export { TwitchClient } from './client.ts'
export type { TwitchConfig } from './config.ts'
export { defaultTwitchConfig } from './config.ts'
export type { HttpResponse, TwitchHttp } from './http.ts'
export { FetchHttp } from './http.ts'
export type {
	AuthContext,
	Manifest,
	ManifestSource,
	QualityVariant,
	ResolveError,
	ResolveResult,
	Twitch,
} from './types.ts'
