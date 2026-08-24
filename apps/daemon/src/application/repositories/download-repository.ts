import type { DownloadModel } from '@/application/models'

export type CreateDownloadParams = {
	streamId: DownloadModel['streamId']
	status: DownloadModel['status']
	storagePath: DownloadModel['storagePath']
	progress?: DownloadModel['progress']
}

export type UpdateDownloadParams = {
	streamId: DownloadModel['streamId']
	status?: DownloadModel['status']
	progress?: DownloadModel['progress']
	endedAt?: DownloadModel['endedAt']
}

export interface DownloadRepository {
	createDownload(params: CreateDownloadParams): Promise<DownloadModel>
	updateDownloadByStreamId(params: UpdateDownloadParams): Promise<DownloadModel>
	findDownloadByStreamId(streamId: string): Promise<DownloadModel | null>
}
