// Tipos do módulo monitor — o gatilho proativo do motor headless (Modulo_Monitor).
// Pollia os monitorados, age na BORDA (offline→live), registra e dispara o recorder.

import type { LiveMetadata } from '../twitch'

export type { LiveMetadata }

export type MonitorState = 'live' | 'offline' | 'unknown'

// A fonte de detecção fica atrás desta interface (a escolha real, spec §3): a impl
// gql (default) delega pro twitch; o HelixDetection entra depois sem tocar no loop.
export interface DetectionSource {
	detect(login: string): Promise<LiveMetadata | null>
}

// Contrato público do módulo — a API (futura) e o composition root acoplam nisto.
export interface Monitor {
	start(): void
	stop(): void
	pollNow(): Promise<void> // força um poll imediato (ex.: após adicionar streamer)
	getState(login: string): MonitorState
}
