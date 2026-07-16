import type { DownloadStatus } from './types'

export type DownloadModel = {
	id: string
	streamId: string
	status: DownloadStatus
	progress: number | null
	storagePath: string
	createdAt: Date
}
