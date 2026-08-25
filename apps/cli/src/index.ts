#!/usr/bin/env bun
import { Command } from 'commander'
import { registerAddChannel } from './commands/add-channel'
import { registerAddHarvestChannel } from './commands/add-harvest-channel'
import { registerChannelDetails } from './commands/channel-details'
import { registerDisableAutoRecording } from './commands/disable-auto-recording'
import { registerDownloadVod } from './commands/download-vod'
import { registerEnableAutoRecording } from './commands/enable-auto-recording'
import { registerListChannels } from './commands/list-channels'
import { registerListHarvestChannels } from './commands/list-harvest-channels'
import { registerPing } from './commands/ping'
import { registerRemoveChannel } from './commands/remove-channel'
import { registerRemoveHarvestChannel } from './commands/remove-harvest-channel'
import { registerStartRecord } from './commands/start-record'
import { registerStopRecord } from './commands/stop-record'

const program = new Command()

program
	.name('scrapper')
	.description('CLI do stream-scrapper — fala com o daemon pelo unix socket')
	.version('0.0.0')

registerPing(program)
registerAddChannel(program)
registerEnableAutoRecording(program)
registerDisableAutoRecording(program)
registerRemoveChannel(program)
registerListChannels(program)
registerStartRecord(program)
registerStopRecord(program)
registerChannelDetails(program)
registerDownloadVod(program)
registerAddHarvestChannel(program)
registerRemoveHarvestChannel(program)
registerListHarvestChannels(program)

program.parseAsync()
