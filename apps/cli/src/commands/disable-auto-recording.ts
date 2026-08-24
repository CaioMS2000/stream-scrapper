import { DisableAutoRecordingResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerDisableAutoRecording(program: Command) {
	program
		.command('disable-auto-recording')
		.description('desliga a gravação automática pra um canal já monitorado')
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'disable-auto-recording', username },
					DisableAutoRecordingResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`auto-record desligado para ${username}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
