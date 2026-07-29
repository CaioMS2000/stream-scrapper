import { unlink } from 'node:fs/promises'
import {
	encodeMessage,
	IpcRequest,
	type IpcResponse,
	LineBuffer,
} from '@repo/ipc'
import type { Socket, UnixSocketListener } from 'bun'
import { IpcRouter, type IpcRouterProps } from './router'

export type IpcServerProps = {
	deps: IpcRouterProps
	socketPath: string
}

// Estado por conexão: cada cliente tem seu próprio buffer de linhas, já que os
// chunks de um não podem se misturar com os de outro.
type ConnState = { buffer: LineBuffer }

export class IpcServer {
	private readonly router: IpcRouter
	private listener?: UnixSocketListener<ConnState>

	constructor(private readonly props: IpcServerProps) {
		this.router = new IpcRouter(props.deps)
	}

	async listen() {
		// Remove socket órfão de uma execução anterior que não fez unlink (crash),
		// senão o bind falha com EADDRINUSE.
		await unlink(this.props.socketPath).catch(() => {})

		this.listener = Bun.listen<ConnState>({
			unix: this.props.socketPath,
			socket: {
				open: socket => {
					socket.data = { buffer: new LineBuffer() }
				},
				data: (socket, chunk) => {
					for (const line of socket.data.buffer.push(chunk.toString())) {
						void this.handleLine(socket, line)
					}
				},
			},
		})
	}

	async close() {
		this.listener?.stop()
		await unlink(this.props.socketPath).catch(() => {})
	}

	// Cada mensagem é isolada: qualquer erro (JSON inválido, comando desconhecido,
	// falha em use case) vira uma resposta de erro — nunca derruba o daemon.
	// É a fronteira de erro que um processo long-running exige.
	private async handleLine(socket: Socket<ConnState>, line: string) {
		let response: IpcResponse
		try {
			const request = IpcRequest.parse(JSON.parse(line))
			response = await this.router.route(request)
		} catch (err) {
			response = {
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			}
		}
		socket.write(encodeMessage(response))
	}
}
