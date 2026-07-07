import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptureEngine, CaptureOpts } from './types.ts'

// Binário local em ./bin tem prioridade; senão cai pro "ffmpeg" do PATH.
function defaultFfmpeg(): string {
	const local = join(import.meta.dir, '..', '..', 'bin', 'ffmpeg')
	return existsSync(local) ? local : 'ffmpeg'
}

// MVP: ffmpeg direto no manifesto live (a lógica provada no live.ts, virada módulo).
// Serve até a stream fechar / -t atingir; morre quando o token do usher expira no
// meio de live LONGA (Modulo_Recorder §3) — por isso o motor fica atrás da interface,
// pra trocar pelo SegmentPullerEngine depois sem tocar no Recorder.
export class FfmpegLiveEngine implements CaptureEngine {
	constructor(private readonly ffmpegPath: string = defaultFfmpeg()) {}

	// Grava .ts (robusto a truncamento). SEM -bsf:a aac_adtstoasc: isso é pra .mp4;
	// no container .ts o AAC (ADTS) vai nativo. Exit ≠ 0 = falha (ENDLIST/-t = 0).
	async capture(
		mediaPlaylistUrl: string,
		tsPath: string,
		opts?: CaptureOpts
	): Promise<void> {
		const args = ['-y', '-i', mediaPlaylistUrl, '-c', 'copy']
		if (opts?.durationSeconds) args.push('-t', String(opts.durationSeconds))
		args.push(tsPath)

		const proc = Bun.spawn([this.ffmpegPath, ...args], {
			stdout: 'inherit',
			stderr: 'inherit',
		})
		const code = await proc.exited
		if (code !== 0) throw new Error(`ffmpeg (capture) saiu com código ${code}`)
	}

	// Finalize (§7): remuxa o .ts consolidado pra .mp4. aac_adtstoasc conserta o
	// AAC no TS→MP4 (Referencia §7). -c copy = sem recodificar.
	async remux(tsPath: string, mp4Path: string): Promise<void> {
		const proc = Bun.spawn(
			[
				this.ffmpegPath,
				'-y',
				'-i',
				tsPath,
				'-c',
				'copy',
				'-bsf:a',
				'aac_adtstoasc',
				mp4Path,
			],
			{ stdout: 'inherit', stderr: 'inherit' }
		)
		const code = await proc.exited
		if (code !== 0) throw new Error(`ffmpeg (remux) saiu com código ${code}`)
	}
}
