import type { IpcRequest, IpcResponse } from '@repo/ipc'
import type {
	AddChannelUseCase,
	EnableAutoRecordingUseCase,
} from '../../application/use-cases'

// Dispatch tipada dos comandos IPC. O Record `handlers` substitui um switch:
// TypeScript enforça exhaustiveness sobre `IpcRequest['cmd']` — adicionar
// uma variante no @repo/ipc sem entry aqui vira erro de compilação.
// O `as Handler<typeof req.cmd>` no return é o único ponto onde o TS não
// correlaciona sozinho a chave do map com o tipo do `req` narrowed.
type Handler<C extends IpcRequest['cmd']> = (
	req: Extract<IpcRequest, { cmd: C }>
) => Promise<IpcResponse>
type Handlers = { [C in IpcRequest['cmd']]: Handler<C> }

export type IpcRouterProps = {
	addChannel: AddChannelUseCase
	enableAutoRecording: EnableAutoRecordingUseCase
}

export class IpcRouter {
	private readonly handlers: Handlers

	constructor(private readonly props: IpcRouterProps) {
		this.handlers = {
			ping: async () => ({ ok: true, cmd: 'ping', uptime: process.uptime() }),

			'add-channel': async req => {
				const result = await this.props.addChannel.execute({
					channelName: req.username,
				})
				if (result.isFailure()) {
					return { ok: false, error: result.value.message }
				}
				return { ok: true, cmd: 'add-channel', channel: result.value }
			},

			'enable-auto-recording': async req => {
				const result = await this.props.enableAutoRecording.execute({
					channelName: req.username,
				})

				if (result.isFailure()) {
					return { ok: false, error: result.value.message }
				}

				return { ok: true, cmd: 'enable-auto-recording' }
			},
		}
	}

	route(req: IpcRequest): Promise<IpcResponse> {
		return (this.handlers[req.cmd] as Handler<typeof req.cmd>)(req)
	}
}
