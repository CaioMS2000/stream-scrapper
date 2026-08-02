#!/usr/bin/env bun
import { Command } from 'commander'
import { registerAddChannel } from './commands/add-channel'
import { registerEnableAutoRecording } from './commands/enable-auto-recording'
import { registerPing } from './commands/ping'

const program = new Command()

program
	.name('scrapper')
	.description('CLI do stream-scrapper — fala com o daemon pelo unix socket')
	.version('0.0.0')

registerPing(program)
registerAddChannel(program)
registerEnableAutoRecording(program)

program.parseAsync()
