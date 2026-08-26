import {
	DownloadAlreadyInProgressError,
	DownloadCapacityExceededError,
	StreamNotFoundError,
	VodDownloadFailedError,
	VodNotRecoverableError,
} from '@/@errors'
import type { ResolvedVia, VideoQuality } from '@/application/models/types'
import type { CdnResolution } from '@/infrastructure/cdn-recovery'
import type { VodDownloader } from '@/infrastructure/downloader'
import type { MediaStorage } from '@/infrastructure/media-storage'
import type { OfficialVodResolution } from '@/infrastructure/official-vod'
import { failure, type Result, success } from '@/result'
import type {
	CdnHostRepository,
	ChannelRepository,
	DownloadRepository,
	StreamRepository,
} from '../repositories'

// Só os parâmetros de negócio (params) — `hosts`/`fetchImpl`/`twitchClient`
// são detalhe de infra que main.ts já resolve na hora de montar a
// closure (ver resolveCdn/resolveOfficial lá). O use case não precisa
// saber de onde vem a lista de hosts, só que a resolução ou funciona ou
// devolve null.
export type ResolveCdnFn = (params: {
	channelName: string
	streamId: string
	startedAt: Date
}) => Promise<CdnResolution | null>

export type ResolveOfficialFn = (params: {
	vodId: string
	qualityPref: VideoQuality
}) => Promise<OfficialVodResolution | null>

type UseCaseProps = {
	streamRepository: StreamRepository
	downloadRepository: DownloadRepository
	channelRepository: ChannelRepository
	cdnHostRepository: CdnHostRepository
	storage: MediaStorage
	downloader: VodDownloader
	// Injetados (não importados direto) porque fazem fetch de rede real —
	// testes de use case passam fakes, sem tocar Twitch/CDN de verdade.
	// Produção passa closures em cima das funções reais de
	// infrastructure/cdn-recovery e infrastructure/official-vod (ver main.ts).
	resolveCdn: ResolveCdnFn
	resolveOfficial: ResolveOfficialFn
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
		let resolvedVia: ResolvedVia | null = null

		if (stream.vodId) {
			const channel = await this.props.channelRepository.findChannel(
				stream.channelName
			)
			resolved = await this.props.resolveOfficial({
				vodId: stream.vodId,
				qualityPref: channel?.qualityPref ?? 'source',
			})
			if (resolved) resolvedVia = 'official'
		}

		if (!resolved) {
			resolved = await this.props.resolveCdn({
				channelName: stream.channelName,
				streamId: stream.streamId,
				startedAt: stream.startedAt,
			})
			if (resolved) resolvedVia = 'cdn'
		}

		if (!resolved || !resolvedVia) {
			return failure(new VodNotRecoverableError(streamId))
		}

		try {
			// Best-effort: harvesting do host não pode derrubar um download que
			// já resolveu com sucesso. Funciona pros dois caminhos — host vindo
			// do oficial (C) também é um host de CDN real, válido pro fallback
			// B em downloads futuros.
			await this.props.cdnHostRepository.recordHost(resolved.host)
		} catch (error) {
			console.error('[download-vod] failed to record cdn host:', error)
		}

		try {
			await this.props.downloadRepository.createDownload({
				streamId: stream.streamId,
				status: 'downloading',
				storagePath: fullPath,
				progress: 0,
				resolvedVia,
				host: resolved.host,
				baseUrl: resolved.baseUrl,
				segments: JSON.stringify(resolved.segments),
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
				host: resolved.host,
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
