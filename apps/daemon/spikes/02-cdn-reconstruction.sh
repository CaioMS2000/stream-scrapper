#!/usr/bin/env bash
# Spike: tenta reconstruir a URL do VOD na CDN a partir de channelName +
# streamId + startedAt já persistidos — sem precisar de vodId nem de token.
# Ver docs/design/002-download-de-vods.md (seção B).
#
# Uso: ./02-cdn-reconstruction.sh <channelName> <streamId> <startedAt_unix>
set -euo pipefail

CHANNEL="${1:?uso: $0 <channelName> <streamId> <startedAt_unix>}"
STREAM_ID="${2:?uso: $0 <channelName> <streamId> <startedAt_unix>}"
STARTED_AT="${3:?uso: $0 <channelName> <streamId> <startedAt_unix>}"

HASHABLE="${CHANNEL}_${STREAM_ID}_${STARTED_AT}"
URLHASH=$(printf '%s' "$HASHABLE" | sha1sum | cut -c1-20)

echo "hashable: $HASHABLE"
echo "urlhash:  $URLHASH"
echo

# Hosts candidatos documentados pela comunidade. CONFIRMADO EM 2026-08-24:
# pra um VOD real testado, o host verdadeiro (d3fi1amfgojobc.cloudfront.net)
# não bateu com NENHUM destes 3 — a fórmula do hash está correta (confirmado
# separadamente contra a mesma URL real), mas a lista de hosts é o elo
# fraco. Ver Riscos #5 no design doc e FINDINGS.md antes de confiar neste
# script pra achar algo de verdade — hoje ele só serve pra validar a
# fórmula do hash, não pra descobrir hosts desconhecidos.
HOSTS=(
	"vod-secure.twitch.tv"
	"d2nvs31859zcd8.cloudfront.net"
	"dqrpb9wgowsf5.cloudfront.net"
)

for HOST in "${HOSTS[@]}"; do
	URL="https://${HOST}/${URLHASH}_${HASHABLE}/chunked/index-dvr.m3u8"
	CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$URL")
	echo "[$CODE] $URL"
done
