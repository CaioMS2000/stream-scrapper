import { PingResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerPing(program: Command) {
	program
		.command('ping')
		.description('checa se o daemon está vivo')
		.option('--json', 'saída crua em JSON')
		.action(async (options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send({ cmd: 'ping' }, PingResponse)
				// stdout = o dado (pipeável); stderr = a conversa paralela.
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`daemon vivo — uptime ${Math.round(res.uptime)}s`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
