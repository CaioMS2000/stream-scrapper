export type Variant = {
	groupId: string
	name: string
	url: string
}

// Master playlist devolvido pelo usher (docs/design/002-download-de-vods.md,
// seção C) — formato confirmado contra a Twitch real em
// apps/daemon/spikes/FINDINGS.md (seção 2). Cada variante é um trio de
// linhas: `#EXT-X-MEDIA` (nome legível, ex "1080p"), `#EXT-X-STREAM-INF`
// (o `GROUP-ID` via atributo `VIDEO="..."`), e a URL na linha seguinte.
export function parseMasterPlaylist(body: string): Variant[] {
	const lines = body.split('\n').map(line => line.trim())
	const variants: Variant[] = []
	let lastName: string | null = null

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line) continue

		if (line.startsWith('#EXT-X-MEDIA:')) {
			const nameMatch = line.match(/NAME="([^"]+)"/)
			lastName = nameMatch?.[1] ?? null
			continue
		}

		if (line.startsWith('#EXT-X-STREAM-INF:')) {
			const groupIdMatch = line.match(/VIDEO="([^"]+)"/)
			const groupId = groupIdMatch?.[1]
			const url = lines[i + 1]
			if (groupId && lastName && url && !url.startsWith('#')) {
				variants.push({ groupId, name: lastName, url })
			}
			lastName = null
		}
	}

	return variants
}
