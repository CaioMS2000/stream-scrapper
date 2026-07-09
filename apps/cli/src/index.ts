#!/usr/bin/env bun
import { Command } from 'commander'
import { registerPing } from './commands/ping'

const program = new Command()

program
	.name('scrapper')
	.description('CLI do stream-scrapper — fala com o daemon pelo unix socket')
	.version('0.0.0')

registerPing(program)

program.parseAsync()
