import type { DownloadModel } from '@/application/models'

export type CreateDownloadParams = {
	streamId: DownloadModel['streamId']
	status: DownloadModel['status']
	storagePath: DownloadModel['storagePath']
	progress?: DownloadModel['progress']
	resolvedVia?: DownloadModel['resolvedVia']
	host?: DownloadModel['host']
	baseUrl?: DownloadModel['baseUrl']
	segments?: DownloadModel['segments']
}

export type UpdateDownloadParams = {
	streamId: DownloadModel['streamId']
	status?: DownloadModel['status']
	progress?: DownloadModel['progress']
	endedAt?: DownloadModel['endedAt']
	segmentIndex?: DownloadModel['segmentIndex']
	byteOffset?: DownloadModel['byteOffset']
	leaseUntil?: DownloadModel['leaseUntil']
}

export interface DownloadRepository {
	createDownload(params: CreateDownloadParams): Promise<DownloadModel>
	updateDownloadByStreamId(params: UpdateDownloadParams): Promise<DownloadModel>
	findDownloadByStreamId(streamId: string): Promise<DownloadModel | null>
	listDownloadsByStatus(
		status: DownloadModel['status']
	): Promise<DownloadModel[]>
}
