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

export const IpcRequest = z.discriminatedUnion('cmd', [
	PingRequest,
	AddChannelRequest,
	EnableAutoRecordingRequest,
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

export const IpcResponse = z.union([
	PingResponse,
	AddChannelResponse,
	EnableAutoRecordingResponse,
	IpcErrorResponse,
])
export type IpcResponse = z.infer<typeof IpcResponse>
