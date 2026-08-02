import { AddChannelResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerAddChannel(program: Command) {
	program
		.command('add-channel')
		.description('adiciona um canal da Twitch pra ser monitorado pelo daemon')
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'add-channel', username },
					AddChannelResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					const state = res.channel.recording
						? 'auto-record ligado'
						: 'auto-record desligado (use enable-auto-recording pra ligar)'
					console.log(`canal ${res.channel.username} adicionado — ${state}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
