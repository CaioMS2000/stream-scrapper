import { describe, expect, test } from 'bun:test'
import { selectVariant } from './quality'
import type { Variant } from './usher'

const chunked: Variant = {
	groupId: 'chunked',
	name: '1080p',
	url: 'chunked-url',
}
const p720: Variant = { groupId: '720p30', name: '720p', url: '720p-url' }
const p480: Variant = { groupId: '480p30', name: '480p', url: '480p-url' }
const p360: Variant = { groupId: '360p30', name: '360p', url: '360p-url' }
const p160: Variant = { groupId: '160p30', name: '160p', url: '160p-url' }
const audioOnly: Variant = {
	groupId: 'audio_only',
	name: 'Audio Only',
	url: 'audio-url',
}

const allVariants = [chunked, p720, p480, p360, p160, audioOnly]

describe('selectVariant', () => {
	test('match exato', () => {
		expect(selectVariant(allVariants, '720p')).toBe(p720)
	})

	test('groupId "chunked" mapeia pra qualidade "source"', () => {
		expect(selectVariant(allVariants, 'source')).toBe(chunked)
	})

	test('sem a qualidade pedida → cai pra próxima MENOR disponível', () => {
		// pediu 1080p, só tem chunked(source)/720p/480p/360p — próxima menor é 720p
		const variants = [chunked, p720, p480]
		expect(selectVariant(variants, '1080p')).toBe(p720)
	})

	test('sem nada menor disponível → cai pra próxima MAIOR', () => {
		// pediu 360p, só tem 480p e chunked(source) disponíveis
		const variants = [chunked, p480]
		expect(selectVariant(variants, '360p')).toBe(p480)
	})

	test('160p e audio_only não são qualidades válidas → ignoradas na seleção', () => {
		const variants = [p160, audioOnly]
		expect(selectVariant(variants, 'source')).toBeNull()
	})

	test('lista vazia → null', () => {
		expect(selectVariant([], 'source')).toBeNull()
	})
})
