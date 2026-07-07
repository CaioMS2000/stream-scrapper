// Tipos do módulo recorder (caminho 3, gravação ao vivo). Espelha o downloader,
// mas sobre uma playlist ROLANTE. O motor de captura fica atrás de uma interface
// (Modulo_Recorder §3/§4) — troca ffmpeg↔puller indolor, sem mexer no resto.

import type { RecordingStatus } from '../store'
import type { Manifest } from '../twitch'

export type { RecordingStatus }

// Handle vivo de uma gravação em andamento/encerrada (Modulo_Recorder §5).
export interface RecordingHandle {
	id: string
	streamId: string
	status: RecordingStatus
	startedAt: number
	quality: string
	storagePath: string
}

export interface CaptureOpts {
	durationSeconds?: number // corta a captura (essencial p/ sanity de segundos)
	// Re-auth: devolve uma URL de media playlist FRESCA quando o token vence, ou
	// null se a live acabou/offline. O SegmentPullerEngine usa; o ffmpeg ignora.
	refresh?: () => Promise<string | null>
}

// O motor de captura: escreve o .ts ao vivo e depois remuxa pra .mp4 no finalize.
// Grava .ts de propósito (robusto a truncamento) e só muxa no fim (§7).
export interface CaptureEngine {
	capture(
		mediaPlaylistUrl: string,
		tsPath: string,
		opts?: CaptureOpts
	): Promise<void>
	remux(tsPath: string, mp4Path: string): Promise<void>
}

export interface RecordOpts {
	quality?: string
	durationSeconds?: number
	// Re-resolve do manifesto live (o composition root fecha sobre twitch + login).
	// O recorder deriva daqui o refresh de URL que o motor consome.
	refresh?: () => Promise<Manifest | null>
}

// Contrato público do módulo — o composition root/monitor acopla nisto.
export interface Recorder {
	record(
		streamId: string,
		manifest: Manifest,
		opts?: RecordOpts
	): Promise<RecordingHandle>
	listActive(): RecordingHandle[]
}
