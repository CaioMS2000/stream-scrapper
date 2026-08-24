# [RESOLVIDO — CONFIRMADO] Sobrevivência pós-live pro canal sem VOD storage

**Objetivo:** descobrir se o path da CDN encontrado enquanto `princessmariaaaaa`
ainda estava ao vivo continua acessível **depois** que a stream terminar —
esse é o cenário real que o caminho B do design doc precisa resolver (VOD
que nunca foi publicada oficialmente).

## Dados capturados (2026-08-24, stream em andamento)

```
channelName: princessmariaaaaa
streamId:    316711750869
startedAt:   2026-08-24T18:10:01Z  (unix 1787595001)
```

`archiveVideo` e `videos()` via GQL sempre vieram vazios pra esse canal
(mesmo depois de >1h de live) — forte indício de VOD storage desligado
nessa conta.

## Resultado positivo já confirmado (enquanto ao vivo)

```
hashable: princessmariaaaaa_316711750869_1787595001
urlhash:  afe18604f021d58a98f6
host:     dgeft87wbj63p.cloudfront.net   (harvested de um VOD da apofigeaa,
                                          canal não-relacionado)

[200] https://dgeft87wbj63p.cloudfront.net/afe18604f021d58a98f6_princessmariaaaaa_316711750869_1787595001/chunked/index-dvr.m3u8
```

Conteúdo real confirmado — `#EXT-X-PROGRAM-DATE-TIME` do primeiro segment
bate com o `createdAt` da stream (delay de ~2s, plausível pro encoder).

## Teste a rodar depois que ela ficar offline

```bash
# 1. confirmar que ficou offline
apps/daemon/spikes/01-vod-discovery-query.sh princessmariaaaaa
# esperado: stream: null

# 2. testar se o path AINDA responde
curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 \
  "https://dgeft87wbj63p.cloudfront.net/afe18604f021d58a98f6_princessmariaaaaa_316711750869_1787595001/chunked/index-dvr.m3u8"
```

- **200 depois de offline** → confirma que dá pra recuperar conteúdo de
  canal sem VOD storage mesmo após o fim da live. Reforça bastante o
  caminho B.
- **403/404 depois de offline** → sugere que sem VOD storage o path é
  derrubado no fim da live — o sucesso "ao vivo" não se traduz em
  recuperação pós-live pra esse tipo de canal. Ainda vale a técnica pra
  canais que TÊM VOD storage mas o listing/API falhou por outro motivo
  (deletado manualmente, sub-only, etc.), só não pra "nunca teve storage".

## Resultado (2026-08-24, mesmo dia)

Confirmada offline (`stream: null`, `videos(): []`). Path testado de novo:

```
[200] https://dgeft87wbj63p.cloudfront.net/afe18604f021d58a98f6_princessmariaaaaa_316711750869_1787595001/chunked/index-dvr.m3u8
```

E melhor que só o 200: o playlist agora tem **`#EXT-X-ENDLIST`** (ausente
enquanto ela estava ao vivo — a live "fechou" o arquivo) e
`#EXT-X-TWITCH-TOTAL-SECS:15276.101` (~4h14min), 1528 segments, do
`PROGRAM-DATE-TIME` inicial (`18:10:03.655Z`) ao final (`22:24:33.655Z` +
6.1s). **A transmissão inteira está lá, completa e baixável**, de um canal
sem nenhuma VOD listada em lugar nenhum da API oficial.

**Conclusão: CONFIRMADO.** O caminho B recupera de verdade conteúdo de
canal com VOD storage desligado, mesmo depois da live terminar. Não é só
"acessível enquanto ao vivo" — é uma cópia persistente e completa.
