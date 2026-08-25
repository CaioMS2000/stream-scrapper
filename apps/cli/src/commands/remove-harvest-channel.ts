import { RemoveHarvestChannelResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerRemoveHarvestChannel(program: Command) {
	program
		.command('remove-harvest-channel')
		.description('remove um canal da lista de harvesting ativo de hosts de CDN')
		.argument('<channelName>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (channelName: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'remove-harvest-channel', channelName },
					RemoveHarvestChannelResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`canal de harvest ${channelName} removido`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
