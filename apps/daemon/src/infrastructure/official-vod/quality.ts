import { VideoQuality } from '@/application/models/types'
import type { Variant } from './usher'

// `chunked` é sempre a qualidade original de gravação (`source`),
// independente da resolução real daquele VOD específico — mesma
// convenção que o caminho B (CDN) já usa pra "source". Fora isso, o
// `NAME` da variante bate exatamente com os literais de `VideoQuality`
// (confirmado contra a Twitch real, ver apps/daemon/spikes/FINDINGS.md
// seção 2) — `160p`/`audio_only` não têm literal correspondente e ficam
// de fora da seleção (nunca são um `qualityPref` válido).
function qualityOf(variant: Variant): VideoQuality | null {
	if (variant.groupId === 'chunked') return 'source'
	return VideoQuality.includes(variant.name as VideoQuality)
		? (variant.name as VideoQuality)
		: null
}

// Match exato primeiro; senão a próxima qualidade MENOR disponível
// (fallback econômico); senão a próxima MAIOR. Sem nenhuma variante
// reconhecida (só 160p/audio_only, por exemplo) → null.
export function selectVariant(
	variants: Variant[],
	qualityPref: VideoQuality
): Variant | null {
	const byQuality = new Map<VideoQuality, Variant>()
	for (const variant of variants) {
		const quality = qualityOf(variant)
		if (quality && !byQuality.has(quality)) byQuality.set(quality, variant)
	}

	const exact = byQuality.get(qualityPref)
	if (exact) return exact

	const prefIndex = VideoQuality.indexOf(qualityPref)

	for (let i = prefIndex + 1; i < VideoQuality.length; i++) {
		const candidate = byQuality.get(VideoQuality[i] as VideoQuality)
		if (candidate) return candidate
	}

	for (let i = prefIndex - 1; i >= 0; i--) {
		const candidate = byQuality.get(VideoQuality[i] as VideoQuality)
		if (candidate) return candidate
	}

	return null
}
