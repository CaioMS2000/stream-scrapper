import { DownloadVodResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { IpcClient } from '../client'

export function registerDownloadVod(program: Command) {
	program
		.command('download-vod')
		.description(
			'baixa o VOD de uma stream já registrada, via recuperação de CDN'
		)
		.argument('<streamId>', 'streamId da stream (não é o vodId da Twitch)')
		.option('--json', 'saída crua em JSON')
		.action(async (streamId: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'download-vod', streamId },
					DownloadVodResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					console.log(`download iniciado para streamId ${streamId}`)
				}
			} catch (err) {
				console.error(
					`erro: ${err instanceof Error ? err.message : String(err)}`
				)
				process.exitCode = 1
			}
		})
}
