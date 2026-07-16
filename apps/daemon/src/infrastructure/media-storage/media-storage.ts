import { mkdirSync } from 'node:fs'
import { dayjs } from '@/config/date-and-time'

export type MediaStorageProps = {
	// Raiz física da persistência: guardada aqui porque os vídeos baixados
	// futuramente também vão viver embaixo dela.
	rootPath: string
}

type CreateStreamPathParams = {
	channelName: string
	title: string
	streamId: string
	startedAt: Date
}
type CreateStreamPathResponse = {
	fullPath: string
}

export class MediaStorage {
	constructor(private readonly props: MediaStorageProps) {}

	ensureChannelPath(channel: string) {
		mkdirSync(`${this.props.rootPath}/${channel}`, { recursive: true })
	}

	createStreamPath(params: CreateStreamPathParams): CreateStreamPathResponse {
		const formatedDate = dayjs(params.startedAt).format('YYYY-MM-DD_HH-mm-ss')
		const fullPath = `${this.props.rootPath}/${params.channelName}/${formatedDate}/${params.title}(${params.streamId})`

		mkdirSync(fullPath, { recursive: true })
		return { fullPath }
	}
}
