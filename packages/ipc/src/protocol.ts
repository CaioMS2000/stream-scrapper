import z from 'zod'

// Contrato de mensagens entre o CLI e o daemon, trafegando por unix socket.
// Fonte única de verdade: os dois lados importam daqui, então os tipos não
// divergem. Mesmo padrão zod-no-fio usado no client GQL (schema.parse no fio).

// --- Requests -------------------------------------------------------------
// Cada comando tem seu schema; `IpcRequest` é a union discriminada em `cmd`
// que o servidor usa pra parsear qualquer mensagem que chega.

export const PingRequest = z.object({
	cmd: z.literal('ping'),
})

export const AddChannelRequest = z.object({
	cmd: z.literal('add-channel'),
	username: z.string().min(1),
})
export type AddChannelRequest = z.infer<typeof AddChannelRequest>

export const EnableAutoRecordingRequest = z.object({
	cmd: z.literal('enable-auto-recording'),
	username: z.string().min(1),
})
export type EnableAutoRecordingRequest = z.infer<
	typeof EnableAutoRecordingRequest
>

export const DisableAutoRecordingRequest = z.object({
	cmd: z.literal('disable-auto-recording'),
	username: z.string().min(1),
})
export type DisableAutoRecordingRequest = z.infer<
	typeof DisableAutoRecordingRequest
>

export const RemoveChannelRequest = z.object({
	cmd: z.literal('remove-channel'),
	username: z.string().min(1),
})
export type RemoveChannelRequest = z.infer<typeof RemoveChannelRequest>

export const ListChannelsRequest = z.object({
	cmd: z.literal('list-channels'),
})
export type ListChannelsRequest = z.infer<typeof ListChannelsRequest>

export const StartRecordRequest = z.object({
	cmd: z.literal('start-record'),
	username: z.string().min(1),
})
export type StartRecordRequest = z.infer<typeof StartRecordRequest>

export const StopRecordRequest = z.object({
	cmd: z.literal('stop-record'),
	username: z.string().min(1),
})
export type StopRecordRequest = z.infer<typeof StopRecordRequest>

export const ChannelDetailsRequest = z.object({
	cmd: z.literal('channel-details'),
	username: z.string().min(1),
})
export type ChannelDetailsRequest = z.infer<typeof ChannelDetailsRequest>

export const DownloadVodRequest = z.object({
	cmd: z.literal('download-vod'),
	streamId: z.string().min(1),
})
export type DownloadVodRequest = z.infer<typeof DownloadVodRequest>

export const IpcRequest = z.discriminatedUnion('cmd', [
	PingRequest,
	AddChannelRequest,
	EnableAutoRecordingRequest,
	DisableAutoRecordingRequest,
	RemoveChannelRequest,
	ListChannelsRequest,
	StartRecordRequest,
	StopRecordRequest,
	ChannelDetailsRequest,
	DownloadVodRequest,
])
export type IpcRequest = z.infer<typeof IpcRequest>

// --- Responses ------------------------------------------------------------
// Toda resposta é ou um sucesso específico do comando, ou o envelope de erro
// comum (`ok: false`). O CLI olha o `ok` pra distinguir — igual o gqlRequest
// olha o status antes de confiar no corpo.

export const IpcErrorResponse = z.object({
	ok: z.literal(false),
	error: z.string(),
})
export type IpcErrorResponse = z.infer<typeof IpcErrorResponse>

export const PingResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('ping'),
	uptime: z.number(), // segundos que o daemon está de pé
})
export type PingResponse = z.infer<typeof PingResponse>

export const AddChannelResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('add-channel'),
	channel: z.object({
		username: z.string(),
		recording: z.boolean(),
	}),
})
export type AddChannelResponse = z.infer<typeof AddChannelResponse>

export const EnableAutoRecordingResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('enable-auto-recording'),
})
export type EnableAutoRecordingResponse = z.infer<
	typeof EnableAutoRecordingResponse
>

export const DisableAutoRecordingResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('disable-auto-recording'),
})
export type DisableAutoRecordingResponse = z.infer<
	typeof DisableAutoRecordingResponse
>

export const RemoveChannelResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('remove-channel'),
})
export type RemoveChannelResponse = z.infer<typeof RemoveChannelResponse>

export const ListChannelsResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('list-channels'),
	channels: z.array(
		z.object({
			username: z.string(),
			displayName: z.string(),
			isLive: z.boolean(),
			isRecording: z.boolean(),
			autoRecord: z.boolean(),
		})
	),
})
export type ListChannelsResponse = z.infer<typeof ListChannelsResponse>

export const StartRecordResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('start-record'),
})
export type StartRecordResponse = z.infer<typeof StartRecordResponse>

export const StopRecordResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('stop-record'),
})
export type StopRecordResponse = z.infer<typeof StopRecordResponse>

// Duplica os literais de VideoQuality/RecordingStatus (definidos em
// apps/daemon/src/application/models/types.ts) — packages/ipc não pode
// importar de apps/daemon (a dependência vai sempre no sentido oposto),
// mesmo trade-off já aceito no resto do protocolo.
const videoQuality = z.enum(['source', '1080p', '720p', '480p', '360p'])
const recordingStatus = z.enum(['recording', 'finished', 'failed'])

export const ChannelDetailsResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('channel-details'),
	channel: z.object({
		username: z.string(),
		displayName: z.string(),
		profileImageURL: z.string().nullable(),
		isLive: z.boolean(),
		autoRecord: z.boolean(),
		qualityPref: videoQuality,
		monitoredSince: z.coerce.date(),
	}),
	streams: z.array(
		z.object({
			streamId: z.string(),
			title: z.string(),
			startedAt: z.coerce.date(),
			category: z.string().nullable(),
			durationSeconds: z.number().nullable(),
			recording: z
				.object({
					status: recordingStatus,
					quality: videoQuality,
					bytes: z.number().nullable(),
					endedAt: z.coerce.date().nullable(),
				})
				.nullable(),
		})
	),
})
export type ChannelDetailsResponse = z.infer<typeof ChannelDetailsResponse>

export const DownloadVodResponse = z.object({
	ok: z.literal(true),
	cmd: z.literal('download-vod'),
})
export type DownloadVodResponse = z.infer<typeof DownloadVodResponse>

export const IpcResponse = z.union([
	PingResponse,
	AddChannelResponse,
	EnableAutoRecordingResponse,
	DisableAutoRecordingResponse,
	RemoveChannelResponse,
	ListChannelsResponse,
	StartRecordResponse,
	StopRecordResponse,
	ChannelDetailsResponse,
	DownloadVodResponse,
	IpcErrorResponse,
])
export type IpcResponse = z.infer<typeof IpcResponse>
