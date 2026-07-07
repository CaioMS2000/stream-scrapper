import { TwitchClient } from './twitch/client'

console.log(`daemon started (pid ${process.pid})`)
async function main() {
	const twitch = new TwitchClient()

	console.dir(await twitch.checkChannel('lexiful'), {
		depth: null,
		colors: true,
	})

	await new Promise<void>(resolve => {
		const shutdown = (signal: NodeJS.Signals) => {
			console.log(`\nreceived ${signal}, shutting down...`)
			resolve()
		}

		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
	})
}

await main()
