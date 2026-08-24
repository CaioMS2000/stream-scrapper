#!/usr/bin/env bash
# Spike: valida como descobrir o vodId de uma stream já registrada via GQL.
# Ver docs/design/002-download-de-vods.md (seção A) e
# ../notes/speculation-vod-discovery-archivevideo-fallback.md
#
# Testa duas hipóteses contra a Twitch real:
#   A. campo `archiveVideo` no `stream` do usuário (só resolve algo se o
#      canal estiver AO VIVO no momento do teste)
#   B. query de listagem de VODs do canal (`videos`, type ARCHIVE) — deveria
#      funcionar independente do canal estar ao vivo
#
# Uso: ./01-vod-discovery-query.sh <login>
set -euo pipefail

LOGIN="${1:-anastasia_lexmur}"
GQL_URL="https://gql.twitch.tv/gql"
CLIENT_ID="kimne78kx3ncx6brgo4mv6wki5h1ko"

echo "== Hipótese A: archiveVideo no campo stream (login=$LOGIN) =="
curl -s "$GQL_URL" \
	-H "Client-Id: $CLIENT_ID" \
	-H "Content-Type: application/json" \
	-d "{\"query\":\"query(\$login: String!) { user(login: \$login) { stream { id createdAt archiveVideo { id } } } }\",\"variables\":{\"login\":\"$LOGIN\"}}" \
	| jq .

echo
echo "== Hipótese B: listagem de VODs do canal (type ARCHIVE) =="
curl -s "$GQL_URL" \
	-H "Client-Id: $CLIENT_ID" \
	-H "Content-Type: application/json" \
	-d "{\"query\":\"query(\$login: String!) { user(login: \$login) { videos(first: 20, type: ARCHIVE) { edges { node { id createdAt title lengthSeconds } } } } } \",\"variables\":{\"login\":\"$LOGIN\"}}" \
	| jq .
