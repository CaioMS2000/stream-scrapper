export interface HarvestChannelRepository {
	listChannels(): Promise<string[]>
	hasChannel(channelName: string): Promise<boolean>
	// Idempotente: canal repetido não duplica (constraint única na tabela).
	addChannel(channelName: string): Promise<void>
	removeChannel(channelName: string): Promise<void>
}
