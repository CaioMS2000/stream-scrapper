import type { StreamRepository } from '@/application/repositories'
import type { LinkVodUseCase } from '@/application/use-cases'
import type { Optional } from '../../@shared/types'

export type VodLinkerProps = {
	intervalMs: number
	streamRepository: StreamRepository
	linkVod: LinkVodUseCase
}

export type VodLinkerConstructorProps = Optional<VodLinkerProps, 'intervalMs'>

function makeDefaultProps() {
	return {
		// Bem mais lenta que o tick de ~30s do ChannelMonitor — VOD leva tempo
		// pra processar depois do fim da live, não faz sentido bater tão forte.
		intervalMs: 10 * 60_000,
	}
}

// Job periódico que descobre o vodId oficial de streams pendentes (caminho
// A, ver docs/design/002-download-de-vods.md). Mesmo mecanismo de
// agendamento do ChannelMonitor — não existe scheduler reaproveitável no
// código hoje, então replica o padrão inline em vez de extrair um genérico.
export class VodLinker {
	private readonly props: VodLinkerProps
	private timer: Timer | null = null

	constructor(props: VodLinkerConstructorProps) {
		this.props = { ...makeDefaultProps(), ...props }
	}

	async start() {
		try {
			await this.tick()
		} catch (error) {
			console.error('[vod-linker] tick failed:', error)
		}
		// setTimeout que se reagenda: garante zero overlap se o tick atrasar —
		// mesmo padrão do ChannelMonitor.
		this.timer = setTimeout(() => this.start(), this.props.intervalMs)
	}

	stop() {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	private async tick() {
		const pending =
			await this.props.streamRepository.listStreamsByVodLookupStatus('pending')

		for (const stream of pending) {
			try {
				const result = await this.props.linkVod.execute({
					streamId: stream.streamId,
				})
				if (result.isFailure()) {
					console.error('[vod-linker]', result.value)
				}
			} catch (error) {
				// Uma stream com erro inesperado não deve abortar o resto do lote.
				console.error(
					`[vod-linker] execute falhou pra streamId ${stream.streamId}:`,
					error
				)
			}
		}
	}
}
