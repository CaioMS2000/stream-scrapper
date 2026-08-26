import { describe, expect, test } from 'bun:test'
import { encodeMessage, LineBuffer } from '@repo/ipc'
import {
	type DoneMessage,
	ExecutorMessage,
	type FailedMessage,
	MaterialMessage,
	type NeedMaterialMessage,
	type ProgressMessage,
} from './protocol'

describe('protocolo pai↔executor', () => {
	test('progress: parse/encode roundtrip', () => {
		const message: ProgressMessage = {
			type: 'progress',
			jobId: 'stream-1',
			segmentIndex: 42,
			byteOffset: 123456,
		}
		expect(ExecutorMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(
			message
		)
	})

	test('need-material: parse/encode roundtrip', () => {
		const message: NeedMaterialMessage = {
			type: 'need-material',
			jobId: 'stream-1',
			fromSegment: 10,
		}
		expect(ExecutorMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(
			message
		)
	})

	test('done: parse/encode roundtrip', () => {
		const message: DoneMessage = { type: 'done', jobId: 'stream-1' }
		expect(ExecutorMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(
			message
		)
	})

	test('failed: parse/encode roundtrip', () => {
		const message: FailedMessage = {
			type: 'failed',
			jobId: 'stream-1',
			error: 'segment fetch failed: 500',
		}
		expect(ExecutorMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(
			message
		)
	})

	test('material: parse/encode roundtrip', () => {
		const message: MaterialMessage = {
			type: 'material',
			jobId: 'stream-1',
			host: 'fake-host.cloudfront.net',
			baseUrl: 'https://fake-host.cloudfront.net/abc/chunked',
			segments: ['0.ts', '1.ts'],
			segmentsFrom: 0,
			byteOffsetFrom: 0,
			destinationPath: '/data/lexi/2026-01-01/title(123)',
			segmentConcurrency: 5,
		}
		expect(MaterialMessage.parse(JSON.parse(JSON.stringify(message)))).toEqual(
			message
		)
	})

	test('ExecutorMessage rejeita type desconhecido', () => {
		expect(() => ExecutorMessage.parse({ type: 'bogus' })).toThrow()
	})

	test('LineBuffer + encodeMessage entregam mensagens completas mesmo cortadas entre chunks', () => {
		const message: ProgressMessage = {
			type: 'progress',
			jobId: 'stream-1',
			segmentIndex: 5,
			byteOffset: 999,
		}
		const encoded = encodeMessage(message)
		const mid = Math.floor(encoded.length / 2)

		const lineBuffer = new LineBuffer()
		const firstHalf = lineBuffer.push(encoded.slice(0, mid))
		expect(firstHalf).toHaveLength(0)

		const secondHalf = lineBuffer.push(encoded.slice(mid))
		expect(secondHalf).toHaveLength(1)
		expect(ExecutorMessage.parse(JSON.parse(secondHalf[0]!))).toEqual(message)
	})
})
