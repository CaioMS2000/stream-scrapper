import { EnableAutoRecordingResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerEnableAutoRecording(program: Command) {
	program
		.command('enable-auto-recording')
		.description('liga a gravação automática pra um canal já monitorado')
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'enable-auto-recording', username },
					EnableAutoRecordingResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`auto-record ligado para ${username}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
