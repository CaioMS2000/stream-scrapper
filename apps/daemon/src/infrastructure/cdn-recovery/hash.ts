type ComputeCdnHashParams = {
	channelName: string
	streamId: string
	startedAt: Date
}

type ComputeCdnHashResult = {
	hashable: string
	urlhash: string
}

// Fórmula usada por ferramentas da comunidade (TwitchRecover, VodRecovery)
// pra reconstruir o path de armazenamento de uma VOD na CDN da Twitch a
// partir só de dados que a `stream` table já persiste — sem vodId, sem
// token. Confirmada byte-a-byte contra dados reais em
// apps/daemon/spikes/FINDINGS.md (seção 3): recalculada localmente contra
// uma URL de CDN real extraída de um master playlist, bateu caractere por
// caractere.
export function computeCdnHash({
	channelName,
	streamId,
	startedAt,
}: ComputeCdnHashParams): ComputeCdnHashResult {
	const startedAtUnix = Math.floor(startedAt.getTime() / 1000)
	const hashable = `${channelName}_${streamId}_${startedAtUnix}`
	const urlhash = new Bun.CryptoHasher('sha1')
		.update(hashable)
		.digest('hex')
		.slice(0, 20)

	return { hashable, urlhash }
}
