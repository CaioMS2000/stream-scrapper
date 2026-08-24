import { RemoveChannelResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerRemoveChannel(program: Command) {
	program
		.command('remove-channel')
		.description(
			'remove um canal monitorado (bloqueado se houver gravação em andamento)'
		)
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'remove-channel', username },
					RemoveChannelResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`canal ${username} removido`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
