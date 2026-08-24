import { DownloadFinalizationFailedError } from '@/@errors'
import { failure, type Result, success } from '@/result'
import type { DownloadRepository } from '../repositories'

type UseCaseProps = {
	downloadRepository: DownloadRepository
}

type UseCaseParams = {
	streamId: string
	endedAt: Date
	status: 'completed' | 'failed'
}

type UseCaseResponse = Result<DownloadFinalizationFailedError, void>

export class FinalizeDownloadUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({
		streamId,
		endedAt,
		status,
	}: UseCaseParams): Promise<UseCaseResponse> {
		try {
			await this.props.downloadRepository.updateDownloadByStreamId({
				streamId,
				endedAt,
				status,
			})
			return success(undefined)
		} catch (error) {
			return failure(
				new DownloadFinalizationFailedError(streamId, { cause: error })
			)
		}
	}
}
