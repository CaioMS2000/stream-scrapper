import { StreamStopFailedError } from '@/@errors'
import type { TwitchRecorder } from '@/infrastructure/recorder'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	recorder: TwitchRecorder
}

type UseCaseParams = {
	channelName: string
}

type UseCaseResponse = Result<StreamStopFailedError, void>

export class StopRecordingUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		try {
			await this.props.recorder.stopStream(channelName)
			return success(undefined)
		} catch (error) {
			return failure(new StreamStopFailedError(channelName, { cause: error }))
		}
	}
}
