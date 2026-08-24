import { describe, expect, test } from 'bun:test'
import { computeCdnHash } from './hash'

// Fixtures reais, confirmadas contra a CDN de verdade — ver
// apps/daemon/spikes/FINDINGS.md (seções 3 e 6). Não são valores
// inventados: foram extraídos de URLs reais devolvidas pela Twitch e
// recalculados localmente batendo caractere por caractere.
describe('computeCdnHash', () => {
	test('apofigeaa — hash extraído de uma URL de CDN real (reverso)', () => {
		const { hashable, urlhash } = computeCdnHash({
			channelName: 'apofigeaa',
			streamId: '318044569575',
			startedAt: new Date(1786285382 * 1000),
		})

		expect(hashable).toBe('apofigeaa_318044569575_1786285382')
		expect(urlhash).toBe('85162296b4d7b239523d')
	})

	test('princessmariaaaaa — hash previsto a partir do stream.id da GQL (forward)', () => {
		const { hashable, urlhash } = computeCdnHash({
			channelName: 'princessmariaaaaa',
			streamId: '316711750869',
			startedAt: new Date('2026-08-24T18:10:01Z'),
		})

		expect(hashable).toBe('princessmariaaaaa_316711750869_1787595001')
		expect(urlhash).toBe('afe18604f021d58a98f6')
	})
})
