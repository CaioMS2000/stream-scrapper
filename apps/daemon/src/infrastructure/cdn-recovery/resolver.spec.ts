import { describe, expect, test } from 'bun:test'
import { resolveViaCdn } from './resolver'

const params = {
	channelName: 'apofigeaa',
	streamId: '318044569575',
	startedAt: new Date(1786285382 * 1000),
}

const REAL_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:EVENT
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
0.ts
#EXTINF:10.000,
1.ts
#EXTINF:6.101,
2.ts
#EXT-X-ENDLIST
`

describe('resolveViaCdn', () => {
	test('host errado (404) → segue pro próximo até achar', async () => {
		const calls: string[] = []
		const fetchImpl = async (url: string) => {
			calls.push(url)
			if (url.includes('host-bom')) {
				return new Response(REAL_PLAYLIST, { status: 200 })
			}
			return new Response('not found', { status: 404 })
		}

		const result = await resolveViaCdn(params, {
			hosts: ['host-ruim-1', 'host-ruim-2', 'host-bom'],
			fetchImpl,
		})

		expect(result).not.toBeNull()
		expect(result?.host).toBe('host-bom')
		expect(result?.segments).toEqual(['0.ts', '1.ts', '2.ts'])
		expect(calls).toHaveLength(3) // parou de tentar assim que achou
	})

	test('nenhum host bate → retorna null', async () => {
		const fetchImpl = async () => new Response('forbidden', { status: 403 })

		const result = await resolveViaCdn(params, {
			hosts: ['host-1', 'host-2'],
			fetchImpl,
		})

		expect(result).toBeNull()
	})

	test('falha de rede/DNS num host não aborta a busca nos outros', async () => {
		const fetchImpl = async (url: string) => {
			if (url.includes('host-com-dns-quebrado')) {
				throw new Error('DNS resolution failed')
			}
			return new Response(REAL_PLAYLIST, { status: 200 })
		}

		const result = await resolveViaCdn(params, {
			hosts: ['host-com-dns-quebrado', 'host-ok'],
			fetchImpl,
		})

		expect(result?.host).toBe('host-ok')
	})
})
