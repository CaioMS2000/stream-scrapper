import { ChannelDetailsResponse, resolveSocketPath } from '@repo/ipc'
import type { Command } from 'commander'
import { dayjs } from '@/config/date-and-time'
import { IpcClient } from '../client'

export function registerChannelDetails(program: Command) {
	program
		.command('channel-details')
		.description(
			'mostra o perfil de um canal e as streams detectadas, marcando quais têm gravação'
		)
		.argument('<username>', 'login do canal (case-insensitive)')
		.option('--json', 'saída crua em JSON')
		.action(async (username: string, options: { json?: boolean }) => {
			const client = new IpcClient(resolveSocketPath())

			try {
				const res = await client.send(
					{ cmd: 'channel-details', username },
					ChannelDetailsResponse
				)
				if (options.json) {
					console.log(JSON.stringify(res))
				} else {
					const { channel, streams } = res
					const status = channel.isLive ? 'ao vivo' : 'offline'
					const formatedDate = dayjs(channel.monitoredSince).format(
						'DD/MM/YYYY'
					)
					const autoRecord = channel.autoRecord
						? 'auto-record: on'
						: 'auto-record: off'
					console.log(
						`${channel.username} (${channel.displayName}) — ${status}, ${autoRecord}`
					)
					console.log(
						`qualidade: ${channel.qualityPref} · monitorado desde ${formatedDate}`
					)
					console.log('')

					if (streams.length === 0) {
						console.log('nenhuma stream detectada')
					} else {
						for (const stream of streams) {
							const markers: string[] = []
							if (stream.recording) {
								markers.push(`[gravado: ${stream.recording.status}]`)
							}
							if (stream.download) {
								markers.push(`[vod baixado: ${stream.download.status}]`)
							}
							const marker =
								markers.length > 0 ? markers.join(' ') : '[sem gravação]'
							const formatedDate = dayjs(stream.startedAt).format('DD/MM/YYYY')
							console.log(
								`${formatedDate} - "${stream.title}" - ${stream.streamId}`
							)
							console.log(`${marker}\n`)
						}
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
