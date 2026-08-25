import { AddHarvestChannelResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerAddHarvestChannel(program: Command) {
	program
		.command('add-harvest-channel')
		.description(
			'adiciona um canal de terceiros à lista usada pelo harvesting ativo de hosts de CDN'
		)
		.argument('<channelName>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (channelName: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'add-harvest-channel', channelName },
					AddHarvestChannelResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`canal de harvest ${channelName} adicionado`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
