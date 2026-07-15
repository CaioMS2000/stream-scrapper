import { mkdirSync } from 'node:fs'

export type MediaStorageProps = {
	// Raiz física da persistência: guardada aqui porque os vídeos baixados
	// futuramente também vão viver embaixo dela.
	rootPath: string
}

export class MediaStorage {
	constructor(private readonly props: MediaStorageProps) {}

	ensureChannelPath(channel: string) {
		mkdirSync(`${this.props.rootPath}/${channel}`, { recursive: true })
	}
}
