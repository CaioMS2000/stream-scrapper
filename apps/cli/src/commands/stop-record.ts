import { resolveSocketPath, StopRecordResponse } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerStopRecord(program: Command) {
	program
		.command('stop-record')
		.description('interrompe manualmente a gravação em andamento de um canal')
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'stop-record', username },
					StopRecordResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`gravação interrompida para ${username}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
