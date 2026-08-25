import type { HarvestChannelRepository } from '@/application/repositories'
import { type Result, success } from '@/result'

type UseCaseProps = {
	harvestChannelRepository: HarvestChannelRepository
}

type UseCaseResponse = Result<never, string[]>

export class ListHarvestChannelsUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute(): Promise<UseCaseResponse> {
		const channels = await this.props.harvestChannelRepository.listChannels()

		return success(channels.sort((a, b) => a.localeCompare(b)))
	}
}
