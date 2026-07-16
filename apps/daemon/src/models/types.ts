export const StreamQuality = [
	'source',
	'1080p',
	'720p',
	'480p',
	'360p',
] as const
export type StreamQuality = (typeof StreamQuality)[number]

export const DownloadStatus = [
	'queued',
	'downloading',
	'completed',
	'failed',
] as const
export type DownloadStatus = (typeof DownloadStatus)[number]

export const RecordingStatus = ['recording', 'finished', 'failed'] as const
export type RecordingStatus = (typeof RecordingStatus)[number]
