import {
	encodeMessage,
	IpcErrorResponse,
	type IpcRequest,
	LineBuffer,
} from '@repo/ipc'
import type { ZodType } from 'zod'

// Erro de comando: o daemon respondeu, mas com `ok: false`. Distingue de falha
// de transporte (daemon fora do ar, socket inexistente), que vem como o erro
// cru do Bun.connect.
export class IpcCommandError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'IpcCommandError'
	}
}

// Cliente fino e de uma tacada só: conecta, manda uma request, lê uma response,
// fecha. É o modelo do CLI curto — sem estado, sem conexão persistente.
export class IpcClient {
	constructor(private readonly socketPath: string) {}

	async send<T>(request: IpcRequest, responseSchema: ZodType<T>): Promise<T> {
		const lineBuffer = new LineBuffer()
		const { promise, resolve, reject } = Promise.withResolvers<T>()

		try {
			await Bun.connect({
				unix: this.socketPath,
				socket: {
					open: socket => {
						socket.write(encodeMessage(request))
					},
					data: (socket, chunk) => {
						const [line] = lineBuffer.push(chunk.toString())
						if (!line) {
							return
						}
						socket.end()

						try {
							const raw: unknown = JSON.parse(line)
							// Mesma disciplina do gqlRequest: olha o sinal de erro
							// primeiro, só então confia no schema de sucesso.
							const asError = IpcErrorResponse.safeParse(raw)
							if (asError.success) {
								reject(new IpcCommandError(asError.data.error))
								return
							}
							resolve(responseSchema.parse(raw))
						} catch (err) {
							reject(err)
						}
					},
					error: (_socket, err) => reject(err),
				},
			})
		} catch (err) {
			// Falhou já no connect: daemon provavelmente não está rodando.
			reject(err)
		}

		return promise
	}
}
