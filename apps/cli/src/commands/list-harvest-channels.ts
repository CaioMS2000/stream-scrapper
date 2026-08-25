import { ListHarvestChannelsResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerListHarvestChannels(program: Command) {
	program
		.command('list-harvest-channels')
		.description('lista os canais da lista de harvesting ativo de hosts de CDN')
		.option('--json', 'saída crua em JSON')
		.action(async (options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'list-harvest-channels' },
					ListHarvestChannelsResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else if (res.channels.length === 0) {
					console.log('nenhum canal de harvest cadastrado')
				} else {
					for (const channelName of res.channels) {
						console.log(channelName)
					}
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
