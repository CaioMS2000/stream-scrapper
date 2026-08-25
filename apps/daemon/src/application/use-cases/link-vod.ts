import { type ChannelNotFoundError, VodLookupFailedError } from '@/@errors'
import type { TwitchClient } from '@/infrastructure/twitch/client'
import { failure, type Result, success } from '@/result'
import type { StreamRepository } from '../repositories'

type UseCaseProps = {
	streamRepository: StreamRepository
	twitchClient: TwitchClient
}

type UseCaseParams = {
	streamId: string
}

type UseCaseResponse = Result<ChannelNotFoundError | VodLookupFailedError, void>

// Tolerância entre o `createdAt` da VOD e o `startedAt` da stream — folga
// generosa acima do delay observado nos spikes (~6s pra canal com VOD
// storage habilitado). Ver apps/daemon/spikes/FINDINGS.md, seção 1.
const MATCH_TOLERANCE_MS = 5 * 60 * 1000

// Depois desse tempo sem achar match, desiste e marca `unavailable` —
// mesmo princípio do doc 001 (nunca deixar um job tentando pra sempre).
const LOOKUP_TIMEOUT_MS = 48 * 60 * 60 * 1000

// Caminho A do design doc (docs/design/002-download-de-vods.md): descobre
// o vodId oficial de uma stream via GQL, consultando a lista de VODs
// arquivadas do canal. A query não expõe o streamId do broadcast — o match
// é por proximidade de createdAt×startedAt, não por join direto de ID.
export class LinkVodUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ streamId }: UseCaseParams): Promise<UseCaseResponse> {
		const stream = await this.props.streamRepository.getStream({ streamId })

		// No-op idempotente: protege contra dupla execução se o VodLinker e
		// algum outro gatilho futuro colidirem no mesmo streamId.
		if (stream.vodLookupStatus !== 'pending') {
			return success(undefined)
		}

		const videosResult = await this.props.twitchClient.getChannelVideos(
			stream.channelName
		)
		if (videosResult.isFailure()) {
			// Canal sumiu da Twitch — deixa `pending`, o timeout de 48h resolve
			// isso também, sem caso especial.
			return failure(videosResult.value)
		}

		const match = closestMatch(videosResult.value, stream.startedAt)

		try {
			if (match) {
				await this.props.streamRepository.updateVodLookup({
					streamId,
					vodId: match.id,
					vodLookupStatus: 'linked',
				})
				return success(undefined)
			}

			const elapsedMs = Date.now() - stream.startedAt.getTime()
			if (elapsedMs > LOOKUP_TIMEOUT_MS) {
				await this.props.streamRepository.updateVodLookup({
					streamId,
					vodId: null,
					vodLookupStatus: 'unavailable',
				})
			}

			// Dentro do prazo, sem match: continua `pending`, tenta de novo no
			// próximo tick — nenhum write necessário.
			return success(undefined)
		} catch (error) {
			return failure(new VodLookupFailedError(streamId, { cause: error }))
		}
	}
}

function closestMatch<T extends { createdAt: Date }>(
	videos: T[],
	startedAt: Date
): T | null {
	let best: T | null = null
	let bestDistanceMs = Number.POSITIVE_INFINITY

	for (const video of videos) {
		const distanceMs = Math.abs(video.createdAt.getTime() - startedAt.getTime())
		if (distanceMs <= MATCH_TOLERANCE_MS && distanceMs < bestDistanceMs) {
			best = video
			bestDistanceMs = distanceMs
		}
	}

	return best
}
