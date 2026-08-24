import { resolveSocketPath, StartRecordResponse } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerStartRecord(program: Command) {
	program
		.command('start-record')
		.description(
			'força o início da gravação de um canal ao vivo, mesmo sem auto-record ligado'
		)
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'start-record', username },
					StartRecordResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`gravação iniciada manualmente para ${username}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
