#!/usr/bin/env bash
# Spike: coleta hosts de CDN reais a partir de master playlists de VODs
# públicas de um canal (técnica sugerida por terceiro: a playlist real é a
# fonte de verdade dos hosts em uso agora, em vez de confiar numa lista
# hardcoded desatualizada). Ver docs/design/002-download-de-vods.md (Risco #5)
# e FINDINGS.md.
#
# Também testa a hipótese de que a CDN é um "pool espelhado" — se o path de
# uma VOD conhecida é alcançável em QUALQUER host ativo coletado, não só no
# host original dela.
#
# Uso: ./04-cdn-host-harvest.sh <login> [controlPathSegment]
#   controlPathSegment = "{urlhash}_{channel}_{streamId}_{startedAt}" de uma
#   VOD que você já confirmou existir (ver 02-cdn-reconstruction.sh) — se
#   omitido, só coleta e lista os hosts, sem testar o "mirrored".
set -euo pipefail

LOGIN="${1:?uso: $0 <login> [controlPathSegment]}"
CONTROL_PATH="${2:-}"
GQL_URL="https://gql.twitch.tv/gql"
CLIENT_ID="kimne78kx3ncx6brgo4mv6wki5h1ko"

echo "== Coletando VODs recentes de $LOGIN =="
VIDEOS=$(curl -s "$GQL_URL" \
	-H "Client-Id: $CLIENT_ID" \
	-H "Content-Type: application/json" \
	-d "{\"query\":\"query(\$login: String!) { user(login: \$login) { videos(first: 10, type: ARCHIVE) { edges { node { id } } } } }\",\"variables\":{\"login\":\"$LOGIN\"}}" \
	| jq -r '.data.user.videos.edges[].node.id')

if [ -z "$VIDEOS" ]; then
	echo "Canal sem VODs arquivadas — nada pra coletar."
	exit 1
fi

echo "$VIDEOS"
echo
echo "== Resolvendo host de cada VOD =="

HOSTS_FOUND=()
for VOD in $VIDEOS; do
	RESP=$(curl -s "$GQL_URL" \
		-H "Client-Id: $CLIENT_ID" \
		-H "Content-Type: application/json" \
		-d "{\"query\":\"query(\$vodID: ID!) { videoPlaybackAccessToken(id: \$vodID, params: {platform: \\\"web\\\", playerBackend: \\\"mediaplayer\\\", playerType: \\\"site\\\"}) { value signature } }\",\"variables\":{\"vodID\":\"$VOD\"}}")
	TOKEN=$(echo "$RESP" | jq -r '.data.videoPlaybackAccessToken.value // empty')
	SIG=$(echo "$RESP" | jq -r '.data.videoPlaybackAccessToken.signature // empty')
	[ -z "$TOKEN" ] && { echo "$VOD: sem token, pulando"; continue; }

	HOST=$(curl -sG "https://usher.ttvnw.net/vod/${VOD}" \
		--data-urlencode "nauth=${TOKEN}" \
		--data-urlencode "nauthsig=${SIG}" \
		--data-urlencode "allow_source=true" \
		--data-urlencode "player=twitchweb" \
		| grep -oP 'https://\K[^/]+' | sort -u | head -1)

	echo "$VOD -> $HOST"
	HOSTS_FOUND+=("$HOST")
done

UNIQUE_HOSTS=($(printf '%s\n' "${HOSTS_FOUND[@]}" | sort -u))
echo
echo "== Hosts únicos coletados =="
printf '%s\n' "${UNIQUE_HOSTS[@]}"

if [ -n "$CONTROL_PATH" ]; then
	echo
	echo "== Teste 'mirrored': $CONTROL_PATH contra cada host coletado =="
	for HOST in "${UNIQUE_HOSTS[@]}"; do
		CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "https://${HOST}/${CONTROL_PATH}/chunked/index-dvr.m3u8")
		echo "[$CODE] $HOST"
	done
fi
