import {
	DownloadAlreadyInProgressError,
	DownloadCapacityExceededError,
	StreamNotFoundError,
	VodDownloadFailedError,
	VodNotRecoverableError,
} from '@/@errors'
import type { resolveViaCdn } from '@/infrastructure/cdn-recovery'
import type { VodDownloader } from '@/infrastructure/downloader'
import type { MediaStorage } from '@/infrastructure/media-storage'
import { failure, type Result, success } from '@/result'
import type { DownloadRepository, StreamRepository } from '../repositories'

type UseCaseProps = {
	streamRepository: StreamRepository
	downloadRepository: DownloadRepository
	storage: MediaStorage
	downloader: VodDownloader
	// Injetado (não importado direto) porque faz fetch de rede real — testes
	// de use case passam um fake, sem tocar a CDN de verdade. Produção passa
	// a função real de infrastructure/cdn-recovery (ver main.ts).
	resolveVod: typeof resolveViaCdn
}

type UseCaseParams = {
	streamId: string
}

type UseCaseResponse = Result<
	| StreamNotFoundError
	| DownloadCapacityExceededError
	| VodNotRecoverableError
	| DownloadAlreadyInProgressError
	| VodDownloadFailedError,
	void
>

// Hoje só tenta o caminho B (recuperação via CDN, ver
// infrastructure/cdn-recovery) — o caminho oficial (A: descoberta via GQL,
// C: auth/playlist oficial) ainda não existe. Ver
// docs/design/002-download-de-vods.md, seção "Fatiado — v1 implementado".
export class DownloadVodUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ streamId }: UseCaseParams): Promise<UseCaseResponse> {
		let stream: Awaited<ReturnType<StreamRepository['getStream']>>
		try {
			stream = await this.props.streamRepository.getStream({ streamId })
		} catch {
			return failure(new StreamNotFoundError(streamId))
		}

		if (!this.props.downloader.hasCapacity()) {
			return failure(new DownloadCapacityExceededError())
		}

		const { fullPath } = this.props.storage.createStreamPath({
			channelName: stream.channelName,
			title: stream.title,
			streamId: stream.streamId,
			startedAt: stream.startedAt,
		})

		const resolved = await this.props.resolveVod({
			channelName: stream.channelName,
			streamId: stream.streamId,
			startedAt: stream.startedAt,
		})
		if (!resolved) {
			return failure(new VodNotRecoverableError(streamId))
		}

		try {
			await this.props.downloadRepository.createDownload({
				streamId: stream.streamId,
				status: 'downloading',
				storagePath: fullPath,
				progress: 0,
			})
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.includes('UNIQUE constraint failed')
			) {
				return failure(new DownloadAlreadyInProgressError(streamId))
			}
			return failure(new VodDownloadFailedError(streamId, { cause: error }))
		}

		try {
			await this.props.downloader.downloadVod({
				streamId: stream.streamId,
				baseUrl: resolved.baseUrl,
				segments: resolved.segments,
				destinationPath: fullPath,
			})
		} catch (error) {
			return failure(new VodDownloadFailedError(streamId, { cause: error }))
		}

		return success(undefined)
	}
}
