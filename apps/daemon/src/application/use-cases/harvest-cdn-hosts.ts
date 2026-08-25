import { CdnHostHarvestFailedError, type ChannelNotFoundError } from '@/@errors'
import type { TwitchClient } from '@/infrastructure/twitch/client'
import { failure, type Result, success } from '@/result'
import type { CdnHostRepository } from '../repositories'
import type { ResolveOfficialFn } from './download-vod'

type UseCaseProps = {
	twitchClient: TwitchClient
	cdnHostRepository: CdnHostRepository
	resolveOfficial: ResolveOfficialFn
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<
	ChannelNotFoundError | CdnHostHarvestFailedError,
	void
>

// Harvesting ATIVO de hosts de CDN — desacoplado de um download real
// (diferente do harvesting orgânico em DownloadVodUseCase, que só grava
// host quando alguém pede um download de verdade). Pega a VOD mais
// recente de um canal, resolve via caminho oficial (C) só pra extrair o
// host, e grava — sem tocar `stream`/`download`. Chamado em loop pelo
// CdnHostHarvester pra dois tipos de canal: monitorados e uma lista
// manual de terceiros (ver infrastructure/cdn-host-harvester,
// decisão de manter descoberta de canal manual documentada na ADR 005).
export class HarvestCdnHostsUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const videosResult = await this.props.twitchClient.getChannelVideos(
			channelName,
			1
		)
		if (videosResult.isFailure()) {
			return failure(videosResult.value)
		}

		const [latestVideo] = videosResult.value
		if (!latestVideo) {
			// Canal sem nenhuma VOD (storage desligado, ou nunca fez live) —
			// nada pra harvestar, não é erro.
			return success(undefined)
		}

		// 'source' fixo: só usamos resolved.host, o resto (segments/baseUrl)
		// é descartado — não existe `channel.qualityPref` pra respeitar aqui,
		// esse use case não baixa nada.
		const resolved = await this.props.resolveOfficial({
			vodId: latestVideo.id,
			qualityPref: 'source',
		})
		if (!resolved) {
			// VOD sub-only/deletada/usher fora do ar — nada pra harvestar.
			return success(undefined)
		}

		try {
			await this.props.cdnHostRepository.recordHost(resolved.host)
		} catch (error) {
			// Diferente do best-effort em DownloadVodUseCase: harvesting é o
			// propósito inteiro deste use case, não efeito colateral de algo
			// mais importante — a falha propaga.
			return failure(
				new CdnHostHarvestFailedError(channelName, { cause: error })
			)
		}

		return success(undefined)
	}
}
