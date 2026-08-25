export interface CdnHostRepository {
	listHosts(): Promise<string[]>
	// Idempotente: host repetido não duplica (constraint única na tabela).
	recordHost(host: string): Promise<void>
}
