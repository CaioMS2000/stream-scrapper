import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import {
	CURRENT_RECORDING_META_SCHEMA_VERSION,
	type RecordingMetaFile,
	recordingMetaFileSchema,
} from './schemas/recording-meta'

type ToMetaFileParams = Omit<RecordingMetaFile, 'meta_schema_version'>

type WriteStreamMetaParams = {
	metaFile: RecordingMetaFile
	storagePath: string
}

type ReadStreamMetaParams = {
	storagePath: string
}

type UpdateStreamMetaParams = {
	storagePath: string
	patch: Pick<RecordingMetaFile, 'endedAt' | 'bytes' | 'status'>
}

export class StreamMetaStorage {
	toMetaFile(data: ToMetaFileParams): RecordingMetaFile {
		return {
			meta_schema_version: CURRENT_RECORDING_META_SCHEMA_VERSION,
			streamId: data.streamId,
			channelName: data.channelName,
			title: data.title,
			startedAt: data.startedAt,
			quality: data.quality,
			endedAt: data.endedAt,
			status: data.status,
			bytes: data.bytes,
		}
	}

	writeStreamMeta({ metaFile, storagePath }: WriteStreamMetaParams) {
		const filePath = `${storagePath}/meta.json`
		const tmp = `${filePath}.temp`

		writeFileSync(tmp, JSON.stringify(metaFile, null, 2))
		renameSync(tmp, filePath)
	}

	readStreamMeta({ storagePath }: ReadStreamMetaParams): RecordingMetaFile {
		const filePath = `${storagePath}/meta.json`
		const raw = readFileSync(filePath, 'utf8')
		return recordingMetaFileSchema.parse(JSON.parse(raw))
	}

	// Read → merge → atomic rewrite. Único ponto de mutação do sidecar depois
	// da escrita inicial. `patch` é o subset que a finalização toca.
	updateStreamMeta({ storagePath, patch }: UpdateStreamMetaParams) {
		const current = this.readStreamMeta({ storagePath })
		const merged: RecordingMetaFile = { ...current, ...patch }
		this.writeStreamMeta({ metaFile: merged, storagePath })
	}
}
