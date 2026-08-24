import { ChannelNotFoundError } from '@/@errors'
import type { RecordingStatus, VideoQuality } from '@/application/models/types'
import type {
	ChannelRepository,
	RecordingRepository,
	StreamRepository,
} from '@/application/repositories'
import { failure, type Result, success } from '@/result'

type UseCaseProps = {
	channelRepository: ChannelRepository
	streamRepository: StreamRepository
	recordingRepository: RecordingRepository
}

type UseCaseParams = {
	channelName: string
}

type StreamRecordingInfo = {
	status: RecordingStatus
	quality: VideoQuality
	bytes: number | null
	endedAt: Date | null
}

type StreamWithRecording = {
	streamId: string
	title: string
	startedAt: Date
	category: string | null
	durationSeconds: number | null
	recording: StreamRecordingInfo | null
}

type ChannelDetails = {
	username: string
	displayName: string
	profileImageURL: string | null
	isLive: boolean
	autoRecord: boolean
	qualityPref: VideoQuality
	monitoredSince: Date
	streams: StreamWithRecording[]
}

type UseCaseResponse = Result<ChannelNotFoundError, ChannelDetails>

export class ChannelDetailsUseCase {
	constructor(private readonly props: UseCaseProps) {}

	async execute({ channelName }: UseCaseParams): Promise<UseCaseResponse> {
		const channel = await this.props.channelRepository.findChannel(channelName)

		if (channel === null) {
			return failure(new ChannelNotFoundError(channelName))
		}

		const streams =
			await this.props.streamRepository.listStreamsByChannel(channelName)

		const streamsWithRecording = await Promise.all(
			streams.map(async stream => {
				const recording =
					await this.props.recordingRepository.findRecordingByStreamId(
						stream.streamId
					)

				return {
					streamId: stream.streamId,
					title: stream.title,
					startedAt: stream.startedAt,
					category: stream.category,
					durationSeconds: stream.durationSeconds,
					recording: recording
						? {
								status: recording.status,
								quality: recording.quality,
								bytes: recording.bytes,
								endedAt: recording.endedAt,
							}
						: null,
				}
			})
		)

		return success({
			username: channel.username,
			displayName: channel.displayName,
			profileImageURL: channel.profileImageURL,
			isLive: channel.isLive,
			autoRecord: channel.autoRecord,
			qualityPref: channel.qualityPref,
			monitoredSince: channel.monitoredSince,
			streams: streamsWithRecording,
		})
	}
}
