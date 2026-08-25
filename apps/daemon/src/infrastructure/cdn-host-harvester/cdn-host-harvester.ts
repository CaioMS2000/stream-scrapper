import type {
	ChannelRepository,
	HarvestChannelRepository,
} from '@/application/repositories'
import type { HarvestCdnHostsUseCase } from '@/application/use-cases'
import type { Optional } from '../../@shared/types'

export type CdnHostHarvesterProps = {
	intervalMs: number
	channelRepository: ChannelRepository
	harvestChannelRepository: HarvestChannelRepository
	harvestCdnHosts: HarvestCdnHostsUseCase
}

export type CdnHostHarvesterConstructorProps = Optional<
	CdnHostHarvesterProps,
	'intervalMs'
>

function makeDefaultProps() {
	return {
		// Mesma cadência do VodLinker — harvesting é best-effort, sem urgência.
		intervalMs: 10 * 60_000,
	}
}

// Harvesting ATIVO de hosts de CDN (ver HarvestCdnHostsUseCase) — roda
// contra dois grupos de canais: os monitorados (ChannelRepository) e uma
// lista de terceiros gerenciada via CLI (HarvestChannelRepository, ver
// add/remove/list-harvest-channels). Mesmo mecanismo de agendamento do
// VodLinker/ChannelMonitor — não existe scheduler reaproveitável no código
// hoje, então replica o padrão inline.
export class CdnHostHarvester {
	private readonly props: CdnHostHarvesterProps
	private timer: Timer | null = null

	constructor(props: CdnHostHarvesterConstructorProps) {
		this.props = { ...makeDefaultProps(), ...props }
	}

	async start() {
		try {
			await this.tick()
		} catch (error) {
			console.error('[cdn-host-harvester] tick failed:', error)
		}
		// setTimeout que se reagenda: garante zero overlap se o tick atrasar —
		// mesmo padrão do VodLinker/ChannelMonitor.
		this.timer = setTimeout(() => this.start(), this.props.intervalMs)
	}

	stop() {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	private async tick() {
		const monitored = await this.props.channelRepository.getAllChannels()
		const harvestList = await this.props.harvestChannelRepository.listChannels()
		// Set deduplica caso um canal monitorado também esteja na lista manual.
		const channelNames = new Set([
			...monitored.map(c => c.username),
			...harvestList,
		])

		for (const channelName of channelNames) {
			try {
				const result = await this.props.harvestCdnHosts.execute({
					channelName,
				})
				if (result.isFailure()) {
					console.error('[cdn-host-harvester]', result.value)
				}
			} catch (error) {
				// Um canal com erro inesperado não deve abortar o resto do lote.
				console.error(
					`[cdn-host-harvester] execute falhou pra channelName ${channelName}:`,
					error
				)
			}
		}
	}
}
