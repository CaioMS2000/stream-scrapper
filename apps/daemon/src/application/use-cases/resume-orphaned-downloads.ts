import { truncateSync } from 'node:fs'
import type { VodDownloader } from '@/infrastructure/downloader'
import { type Result, success } from '@/result'
import type { DownloadRepository } from '../repositories'

type UseCaseProps = {
	downloadRepository: DownloadRepository
	downloader: VodDownloader
}

type UseCaseResponse = Result<never, void>

// Boot scan / cold resume (past conversations/decisoes-downloader.md §7 e
// §12): toda `download` com status `downloading` sobrevivente de um
// restart do daemon é, por definição, órfã de processo (o pai que
// supervisionava o child morreu junto — não há memória de PIDs pra
// herdar). `leaseUntil` distingue "renovado recentemente por um executor
// que ainda pode estar vivo" (lease no futuro — não deveria acontecer
// logo após boot num processo novo, mas conservador: pula e loga) de
// "órfão de verdade" (lease vencido ou nunca setado — rows de antes desta
// feature existir).
//
// Não re-resolve nada: `host`/`baseUrl`/`segments` já estão persistidos
// (imutáveis por VOD, ver DownloadVodUseCase) — só trunca o arquivo pro
// `byteOffset` confirmado (descarta a cauda não confirmada, §8) e
// respawna o executor a partir do `segmentIndex` salvo.
export class ResumeOrphanedDownloadsUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute(): Promise<UseCaseResponse> {
		const orphans =
			await this.props.downloadRepository.listDownloadsByStatus('downloading')
		const now = Date.now()

		for (const orphan of orphans) {
			if (orphan.leaseUntil && orphan.leaseUntil.getTime() > now) {
				console.warn(
					`[resume-orphaned-downloads] ${orphan.streamId}: lease ainda válido, pulando (inesperado logo após boot)`
				)
				continue
			}

			if (!orphan.host || !orphan.baseUrl || !orphan.segments) {
				// Row de antes desta feature existir — sem material persistido,
				// não dá pra retomar. Marca como failed em vez de deixar
				// `downloading` pra sempre.
				console.warn(
					`[resume-orphaned-downloads] ${orphan.streamId}: sem material persistido, marcando como failed`
				)
				await this.props.downloadRepository
					.updateDownloadByStreamId({
						streamId: orphan.streamId,
						status: 'failed',
						endedAt: new Date(),
					})
					.catch(error => {
						console.error('[resume-orphaned-downloads]', error)
					})
				continue
			}

			const outputPath = `${orphan.storagePath}/stream.ts`
			try {
				truncateSync(outputPath, orphan.byteOffset)
			} catch (error) {
				const isMissingFile =
					error instanceof Error &&
					'code' in error &&
					(error as NodeJS.ErrnoException).code === 'ENOENT'
				if (!isMissingFile) {
					console.error(
						`[resume-orphaned-downloads] ${orphan.streamId}: falha ao truncar arquivo, pulando:`,
						error
					)
					continue
				}
				// Arquivo ainda não existe (crash antes do 1º segment) — ok,
				// retomar do zero é seguro nesse caso.
			}

			try {
				await this.props.downloader.downloadVod({
					streamId: orphan.streamId,
					host: orphan.host,
					baseUrl: orphan.baseUrl,
					segments: JSON.parse(orphan.segments),
					destinationPath: orphan.storagePath,
					resumeFrom: {
						segmentIndex: orphan.segmentIndex,
						byteOffset: orphan.byteOffset,
					},
				})
			} catch (error) {
				console.error(
					`[resume-orphaned-downloads] ${orphan.streamId}: falha ao retomar:`,
					error
				)
			}
		}

		return success(undefined)
	}
}
