import type { DownloadStatus, ResolvedVia } from './types'

export type DownloadModel = {
	id: string
	streamId: string
	status: DownloadStatus
	progress: number | null
	storagePath: string
	createdAt: Date
	endedAt: Date | null
	resolvedVia: ResolvedVia | null
	host: string | null
	baseUrl: string | null
	segments: string | null
	segmentIndex: number
	byteOffset: number
	leaseUntil: Date | null
}
