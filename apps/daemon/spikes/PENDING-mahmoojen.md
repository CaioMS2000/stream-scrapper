# [RESOLVIDO — REFUTADO] Sobrevivência pós-live pro canal sem VOD storage

**Objetivo:** descobrir se o path da CDN encontrado enquanto `mahmoojen`
ainda estava ao vivo continua acessível **depois** que a stream terminar —
esse é o cenário real que o caminho B do design doc precisa resolver (VOD
que nunca foi publicada oficialmente).

## Dados capturados (2026-08-24, stream em andamento)

```
channelName: mahmoojen
streamId:    318861986676
startedAt:   2026-08-24T19:52:21Z  (unix 1787601141)
```

`archiveVideo` e `videos()` via GQL vieram vazios pra esse canal (mesmo
depois de >6h de live) — forte indício de VOD storage desligado nessa
conta.

## Resultado positivo já confirmado (enquanto ao vivo)

```
hashable: mahmoojen_318861986676_1787601141
urlhash:  eb2c5d307cb4aca68cac
host:     d1m7jfoe9zdc1j.cloudfront.net

[200] https://d1m7jfoe9zdc1j.cloudfront.net/eb2c5d307cb4aca68cac_mahmoojen_318861986676_1787601141/chunked/index-dvr.m3u8
```

Playlist real confirmado — `#EXT-X-PLAYLIST-TYPE:EVENT` e
`#EXT-X-TWITCH-TOTAL-SECS:22536.550` batem com o tempo decorrido desde o
`createdAt` da stream (checado às 2026-08-25T02:08Z, ~6h15min depois do
início — diferença de poucos segundos, plausível pro encoder).

## Teste a rodar depois que ela ficar offline

```bash
# 1. confirmar que ficou offline
apps/daemon/spikes/01-vod-discovery-query.sh mahmoojen
# esperado: stream: null

# 2. testar se o path AINDA responde
curl -s -o /dev/null -w "%{http_code}\n" --max-time 8 \
  "https://d1m7jfoe9zdc1j.cloudfront.net/eb2c5d307cb4aca68cac_mahmoojen_318861986676_1787601141/chunked/index-dvr.m3u8"
```

- **200 depois de offline** → confirma que dá pra recuperar conteúdo de
  canal sem VOD storage mesmo após o fim da live. Reforça bastante o
  caminho B.
- **403/404 depois de offline** → sugere que sem VOD storage o path é
  derrubado no fim da live — o sucesso "ao vivo" não se traduz em
  recuperação pós-live pra esse tipo de canal. Ainda vale a técnica pra
  canais que TÊM VOD storage mas o listing/API falhou por outro motivo
  (deletado manualmente, sub-only, etc.), só não pra "nunca teve storage".

## Resultado (2026-08-25)

Confirmada offline (`stream: null`, `videos(): []`). Path testado de novo:

```
[403] https://d1m7jfoe9zdc1j.cloudfront.net/eb2c5d307cb4aca68cac_mahmoojen_318861986676_1787601141/chunked/index-dvr.m3u8
```

Re-testei também os outros 4 hosts conhecidos (`d3fi1amfgojobc`,
`dgeft87wbj63p`, `vod-secure.twitch.tv`, `d2nvs31859zcd8`) com o mesmo
hash — todos 403. Não é um host errado: é o mesmo host que respondeu 200
enquanto ela estava ao vivo, agora fechado.

**Conclusão: REFUTADO — pelo menos pra este canal.** Ao contrário do teste
com `princessmariaaaaa` (mesmo cenário: sem VOD storage, path acessível ao
vivo), aqui o path foi derrubado assim que a live terminou. O sucesso
"acessível ao vivo" **não garante** sobrevivência pós-live pra canal sem
storage — parece depender de algo além de "ter ou não VOD storage
habilitado" (timing do teste, política de retenção variável por CDN edge,
ou alguma outra condição não identificada).

**Implicação pro caminho B:** a garantia que o design doc registrava como
"confirmada" (ver
[docs/decisions/005-cdn-vod-recovery-scope.md](../../../docs/decisions/005-cdn-vod-recovery-scope.md)
e [FINDINGS.md](./FINDINGS.md)) era baseada num único caso positivo
(`princessmariaaaaa`). Este segundo teste, com resultado oposto, sugere que
a técnica é mais frágil/inconsistente do que aquele único caso levava a
crer — vale considerar registrar essa amostra de 1-positivo-1-negativo em
FINDINGS.md e revisitar a confiança depositada nesse caminho pro cenário
específico de "canal sem VOD storage" (o cenário "tem storage mas
listagem falhou" não é afetado por essa dúvida, já que nesse caso o
caminho A/C tende a resolver primeiro).
