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
import type { resolveViaOfficial } from '@/infrastructure/official-vod'
import { failure, type Result, success } from '@/result'
import type {
	ChannelRepository,
	DownloadRepository,
	StreamRepository,
} from '../repositories'

type UseCaseProps = {
	streamRepository: StreamRepository
	downloadRepository: DownloadRepository
	channelRepository: ChannelRepository
	storage: MediaStorage
	downloader: VodDownloader
	// Injetados (não importados direto) porque fazem fetch de rede real —
	// testes de use case passam fakes, sem tocar Twitch/CDN de verdade.
	// Produção passa as funções reais de infrastructure/cdn-recovery e
	// infrastructure/official-vod (ver main.ts).
	resolveCdn: typeof resolveViaCdn
	resolveOfficial: typeof resolveViaOfficial
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

// Tenta o caminho oficial (C) primeiro quando a stream já tem `vodId`
// (populado pelo caminho A, ver LinkVodUseCase) — só ele respeita
// `channel.qualityPref`, e usa o mesmo caminho de auth que qualquer
// visualizador anônimo usaria. Cai pro caminho B (CDN) só quando o
// oficial não resolve (sem vodId ainda, VOD deletada/sub-only, usher
// fora do ar) — B contorna deliberadamente um controle de acesso da
// Twitch/streamer (zona cinzenta de ToS, ver Risco #3 do design doc), não
// é a primeira escolha. Ver docs/design/002-download-de-vods.md.
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

		let resolved: Awaited<ReturnType<typeof this.props.resolveCdn>> = null

		if (stream.vodId) {
			const channel = await this.props.channelRepository.findChannel(
				stream.channelName
			)
			resolved = await this.props.resolveOfficial({
				vodId: stream.vodId,
				qualityPref: channel?.qualityPref ?? 'source',
			})
		}

		if (!resolved) {
			resolved = await this.props.resolveCdn({
				channelName: stream.channelName,
				streamId: stream.streamId,
				startedAt: stream.startedAt,
			})
		}

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
