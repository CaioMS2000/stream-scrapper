#!/usr/bin/env bash
# Spike: valida o fluxo oficial de resolução de playlist pra um vodId
# conhecido — PlaybackAccessToken (GQL) -> usher -> master m3u8.
# Ver docs/design/002-download-de-vods.md (seção C).
#
# Depende de um vodId real — ainda não temos um confirmado (a stream de
# teste no nosso DB tem vod_id nulo). Rodar depois que 01-vod-discovery-query.sh
# (ou um vodId conhecido manualmente) der um id válido.
#
# O shape exato da query abaixo é um CHUTE baseado em como a comunidade
# documenta o endpoint — não confirmado contra a API real ainda. Esperado
# que a primeira tentativa possa falhar com erro de schema; o erro em si é
# informação útil (Twitch geralmente diz qual argumento/campo é inválido).
#
# Uso: ./03-playback-access-token.sh <vodId>
set -euo pipefail

VOD_ID="${1:?uso: $0 <vodId>}"
GQL_URL="https://gql.twitch.tv/gql"
CLIENT_ID="kimne78kx3ncx6brgo4mv6wki5h1ko"

echo "== Passo 1: PlaybackAccessToken via query raw (sem persisted query) =="
RESP=$(curl -s "$GQL_URL" \
	-H "Client-Id: $CLIENT_ID" \
	-H "Content-Type: application/json" \
	-d "{\"query\":\"query(\$vodID: ID!) { videoPlaybackAccessToken(id: \$vodID, params: {platform: \\\"web\\\", playerBackend: \\\"mediaplayer\\\", playerType: \\\"site\\\"}) { value signature } }\",\"variables\":{\"vodID\":\"$VOD_ID\"}}")
echo "$RESP" | jq .

TOKEN=$(echo "$RESP" | jq -r '.data.videoPlaybackAccessToken.value // empty')
SIG=$(echo "$RESP" | jq -r '.data.videoPlaybackAccessToken.signature // empty')

if [ -z "$TOKEN" ] || [ -z "$SIG" ]; then
	echo "Token/assinatura vazios — query raw provavelmente não é aceita (Twitch pode exigir persisted query nesse endpoint específico). Ver Riscos #1 no design doc."
	exit 1
fi

echo
echo "== Passo 2: usher -> master playlist =="
# O `value` do token é JSON cru (tem {, }, espaços) — precisa ir URL-encoded
# na query string. -G --data-urlencode faz isso corretamente.
curl -sG "https://usher.ttvnw.net/vod/${VOD_ID}" \
	--data-urlencode "nauth=${TOKEN}" \
	--data-urlencode "nauthsig=${SIG}" \
	--data-urlencode "allow_source=true" \
	--data-urlencode "allow_audio_only=true" \
	--data-urlencode "player=twitchweb"
