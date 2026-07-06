import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadStrategy } from './types.ts'

// Binário local em ./bin tem prioridade; senão cai pro "ffmpeg" do PATH.
function defaultFfmpeg(): string {
	const local = join(import.meta.dir, '..', '..', 'bin', 'ffmpeg')
	return existsSync(local) ? local : 'ffmpeg'
}

// VOD é playlist FECHADA (um token, todos os segmentos conhecidos) → o ffmpeg cru
// serve, o que era veneno no recorder. Delega o pesado ao binário; só orquestra.
export class FfmpegStrategy implements DownloadStrategy {
	constructor(private readonly ffmpegPath: string = defaultFfmpeg()) {}

	async download(
		mediaPlaylistUrl: string,
		outputPath: string,
		opts?: { durationSeconds?: number }
	): Promise<void> {
		// -c copy = sem recodificar; aac_adtstoasc conserta o AAC no TS→MP4 (Ref §7).
		const args = [
			'-y',
			'-i',
			mediaPlaylistUrl,
			'-c',
			'copy',
			'-bsf:a',
			'aac_adtstoasc',
		]
		if (opts?.durationSeconds) args.push('-t', String(opts.durationSeconds))
		args.push(outputPath)

		const proc = Bun.spawn([this.ffmpegPath, ...args], {
			stdout: 'inherit',
			stderr: 'inherit',
		})
		const code = await proc.exited
		if (code !== 0) throw new Error(`ffmpeg saiu com código ${code}`)
	}
}
