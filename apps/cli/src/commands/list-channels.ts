import { ListChannelsResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerListChannels(program: Command) {
	program
		.command('list-channels')
		.description('lista os canais monitorados e o status de cada um')
		.option('--json', 'saída crua em JSON')
		.action(async (options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'list-channels' },
					ListChannelsResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else if (res.channels.length === 0) {
					console.log('nenhum canal cadastrado')
				} else {
					for (const channel of res.channels) {
						const status = channel.isLive ? 'ao vivo' : 'offline'
						const recording = channel.isRecording ? ', gravando' : ''
						const autoRecord = channel.autoRecord
							? 'auto-record: on'
							: 'auto-record: off'
						console.log(
							`${channel.username} (${channel.displayName}) — ${status}${recording}, ${autoRecord}`
						)
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
