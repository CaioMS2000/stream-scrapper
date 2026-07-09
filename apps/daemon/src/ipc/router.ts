import type { IpcRequest, IpcResponse } from '@repo/ipc'
import type { Engine } from '../engine'

// Traduz um comando do protocolo numa chamada à Engine. É o único lugar que
// conhece protocolo E Engine ao mesmo tempo — o server só cuida do transporte,
// a Engine não sabe que IPC existe.
// biome-ignore lint/correctness/noUnusedFunctionParameters: seam de DI — os próximos comandos (status/list/...) leem a Engine daqui.
export function createRouter(engine: Engine) {
	return async (request: IpcRequest): Promise<IpcResponse> => {
		switch (request.cmd) {
			case 'ping':
				return { ok: true, cmd: 'ping', uptime: process.uptime() }
		}
	}
}
