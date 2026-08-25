import type { HarvestChannelRepository } from '@/application/repositories'
import { type Result, success } from '@/result'

type UseCaseProps = {
	harvestChannelRepository: HarvestChannelRepository
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<never, void>

export class AddHarvestChannelUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		await this.props.harvestChannelRepository.addChannel(channelName)

		return success(undefined)
	}
}
