import type { ChannelModel } from '@/application/models'
import type { DrizzleClient } from '@/lib/drizzle'

export type ChannelRepositoryProps = {
	drizzle: DrizzleClient
}

export type AddChannelOptionalParams = {
	qualityPref?: ChannelModel['qualityPref']
	name: ChannelModel['displayName']
	autoRecord?: ChannelModel['autoRecord']
	profileImageURL?: ChannelModel['profileImageURL']
}

export type ChannelUpdateParams = Partial<Omit<ChannelModel, 'id'>> & {
	id: ChannelModel['id']
}

/**
 * Repositório de canais monitorados.
 *
 * **Convenção de username**: sempre armazenado em lowercase. Métodos que
 * recebem `channel: string` como identificador (`findChannel`, `addChannel`)
 * normalizam a entrada antes de comparar/gravar — chame com o case que quiser.
 * `displayName` preserva o case original pra apresentação humana.
 *
 * Consequência: consumidores downstream (Monitor, Recorder) podem confiar
 * que `channel.username` já vem lowercase da DB, sem precisar re-normalizar.
 */
export interface ChannelRepository {
	findChannel(channel: string): Promise<ChannelModel | null>
	addChannel(
		channel: string,
		params?: AddChannelOptionalParams
	): Promise<ChannelModel>
	updateChannel(channel: ChannelUpdateParams): Promise<ChannelModel>
	deleteChannel(channel: string): Promise<void>
	getAllChannels(): Promise<ChannelModel[]>
}
