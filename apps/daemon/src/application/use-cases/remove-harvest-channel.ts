import { HarvestChannelNotFoundError } from '@/@errors'
import type { HarvestChannelRepository } from '@/application/repositories'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	harvestChannelRepository: HarvestChannelRepository
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<HarvestChannelNotFoundError, void>

export class RemoveHarvestChannelUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const exists =
			await this.props.harvestChannelRepository.hasChannel(channelName)

		if (!exists) {
			return failure(new HarvestChannelNotFoundError(channelName))
		}

		await this.props.harvestChannelRepository.removeChannel(channelName)

		return success(undefined)
	}
}
