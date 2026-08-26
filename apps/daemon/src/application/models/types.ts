export const VideoQuality = ['source', '1080p', '720p', '480p', '360p'] as const
export type VideoQuality = (typeof VideoQuality)[number]

export const DownloadStatus = [
	'queued',
	'downloading',
	'completed',
	'failed',
] as const
export type DownloadStatus = (typeof DownloadStatus)[number]

export const RecordingStatus = ['recording', 'finished', 'failed'] as const
export type RecordingStatus = (typeof RecordingStatus)[number]

export const VodLookupStatus = ['pending', 'linked', 'unavailable'] as const
export type VodLookupStatus = (typeof VodLookupStatus)[number]

// De qual caminho de resolução (docs/design/002-download-de-vods.md) veio
// o material persistido de um download — metadado/observabilidade, ver
// ResumeOrphanedDownloadsUseCase.
export const ResolvedVia = ['cdn', 'official'] as const
export type ResolvedVia = (typeof ResolvedVia)[number]
