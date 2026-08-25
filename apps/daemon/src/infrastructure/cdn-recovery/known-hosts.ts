import type { CdnHostRepository } from '@/application/repositories'

// Hosts de CDN confirmados empiricamente contra streams reais — ver
// apps/daemon/spikes/FINDINGS.md (seções 3, 4 e 6) — mais os 2 candidatos
// originais documentados pela comunidade (TwitchRecover/VodRecovery), que
// nunca bateram nos nossos testes reais mas ficam como candidatos baratos.
//
// Só usado como seed inicial da tabela `cdn_host` (ver seedKnownCdnHosts
// abaixo) — depois do primeiro boot, o pool cresce organicamente a cada
// resolução bem-sucedida (ver DownloadVodUseCase). Antes do harvesting
// orgânico existir, esta era a lista estática usada em runtime
// diretamente (infrastructure/cdn-recovery/host-pool.ts, removido).
export const KNOWN_CDN_HOSTS: readonly string[] = [
	'd3fi1amfgojobc.cloudfront.net',
	'dgeft87wbj63p.cloudfront.net',
	'd1m7jfoe9zdc1j.cloudfront.net',
	'vod-secure.twitch.tv',
	'd2nvs31859zcd8.cloudfront.net',
]

// Idempotente (recordHost ignora host repetido) — seguro de chamar em
// todo boot, não só na primeira vez.
export async function seedKnownCdnHosts(
	cdnHostRepository: CdnHostRepository
): Promise<void> {
	for (const host of KNOWN_CDN_HOSTS) {
		await cdnHostRepository.recordHost(host)
	}
}
