# Findings

Resultados dos spikes rodados contra a Twitch real. Data de todos os testes
abaixo: **2026-08-24**. GQL não é documentado oficialmente — revalidar se
muito tempo passar antes de confiar de novo nesses resultados.

## 1. Descoberta de VOD (`01-vod-discovery-query.sh`)

**Canal testado:** `anastasia_lexmur` (offline no momento, sem VOD algum —
`vod_id` já nulo no nosso DB) e `apofigeaa` (offline no momento, com VODs
públicos).

**Hipótese A — campo `archiveVideo` no `stream`:** ✅ **campo existe no
schema**. A resposta veio limpa (`stream: null` porque o canal estava
offline), sem erro de validação — se `archiveVideo` não existisse como campo
válido do tipo `Stream`, o GQL teria devolvido erro de schema em vez de
`data` limpo (a validação acontece antes da execução, independente do valor
em runtime). **Ainda não confirmado que vem preenchido durante uma live real**
— nenhum dos dois canais estava ao vivo no momento do teste. Falta esse
último passo pra promover a especulação em
[speculation-vod-discovery-archivevideo-fallback.md](../notes/speculation-vod-discovery-archivevideo-fallback.md)
de "hipótese" pra "confirmado".

**Hipótese B — `videos(first, type: ARCHIVE)`:** ✅ **confirmado, funciona**.
Contra `apofigeaa`, devolveu 10 VODs reais com `id`, `createdAt`,
`lengthSeconds`. Essa é a query de descoberta oficial validada — vira a base
do passo 2 do plano no design doc.

Exemplo de resposta real (`apofigeaa`):
```json
{
  "node": {
    "id": "2841524354",
    "createdAt": "2026-08-09T14:23:07Z",
    "title": "купаемся в купальниках💦💦💦💦",
    "lengthSeconds": 7818
  }
}
```

**Pendência:** essa query não expõe o `stream_id` (ID do broadcast) do VOD —
só `id` (o próprio vodId), `createdAt`, `title`, `lengthSeconds`. Pra casar
um VOD da lista com uma `stream` já registrada no nosso banco, o match
precisa ser por proximidade de `createdAt` × `stream.startedAt` (mesmo
canal, timestamps próximos), não por join direto de ID. Isso é uma revisão
importante do plano original do design doc (assumia join direto por
`stream_id`).

## 2. PlaybackAccessToken + usher (`03-playback-access-token.sh`)

**VOD testado:** `2841524354` (apofigeaa, público, 7818s).

✅ **Totalmente confirmado, ponta a ponta.** E uma simplificação real em
relação ao que eu esperava: **a query raw funciona, sem precisar de
persisted query (hash sha256)** — bati a query como texto puro, igual ao
resto do `gql.ts` do projeto, e a Twitch aceitou normalmente. Isso reduz o
Risco #1 do design doc: não precisamos reverse-engenheirar hash nenhum pra
esse endpoint específico, pelo menos hoje.

Resposta real do token (dados sensíveis como `signature` omitidos aqui, só
o formato):
```json
{
  "authorization": {"forbidden": false, "reason": ""},
  "chansub": {"restricted_bitrates": []},
  "maximum_resolution": "FULL_HD",
  "vod_id": 2841524354
}
```

`forbidden: false` e `chansub.restricted_bitrates: []` confirmam que dá pra
distinguir VOD público de VOD sub-only só olhando essa resposta (sem
precisar tentar baixar pra descobrir). `maximum_resolution: FULL_HD` com
`AUTHZ_NOT_LOGGED_IN` como motivo pra não liberar 1440p/4K é esperado —
anônimo tem teto em 1080p, o que cobre a faixa de `qualityPref` que o
projeto já usa (`source` até `360p`).

O usher devolveu o master playlist completo, com as 5 variantes de
qualidade esperadas (1080p/720p/480p/360p/160p + audio_only) — confirma a
seção C do design doc como desenhada, e resolve a escolha de qualidade via
`qualityPref` sem mudança de plano.

## 3. Reconstrução via CDN (`02-cdn-reconstruction.sh`)

**Achado principal: a fórmula do hash está 100% correta.** O master
playlist do teste 2 (ponto anterior) **expôs a URL real da CDN**:

```
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/chunked/index-dvr.m3u8
```

Extraindo os componentes daí (`channelName=apofigeaa`,
`streamId=318044569575`, `startedAt=1786285382`) e recalculando o hash
localmente:

```
$ printf '%s' "apofigeaa_318044569575_1786285382" | sha1sum | cut -c1-20
85162296b4d7b239523d    ← bate exatamente com o hash real da URL da Twitch
```

**Confirmado, formula correta**, exatamente como documentado na seção B do
design doc.

**Mas achamos um problema real que o design doc só previa em abstrato (Risco
#5):** o host da CDN nesse caso real foi `d3fi1amfgojobc.cloudfront.net` —
**nenhum dos três hosts** que o script tentava por padrão
(`vod-secure.twitch.tv`, `d2nvs31859zcd8.cloudfront.net`,
`dqrpb9wgowsf5.cloudfront.net`) bateu. O terceiro nem resolveu DNS. Ou seja:
**a fórmula do hash é necessária mas não suficiente** — sem saber o host
certo de antemão, o probe às cegas contra uma lista curta de hosts
conhecidos tem chance real de nunca acertar, porque o host parece ser
atribuído por broadcast/CDN-node, não um pool pequeno e fixo.

Isso muda a avaliação de risco da seção B do design doc: a recuperação via
CDN só é confiável hoje **quando já temos o host correto de outra fonte**
(ex.: capturado da mesma resposta do usher enquanto o VOD ainda estava
oficialmente acessível — o que é meio contraditório com o propósito do
fallback, que é justamente pra quando o caminho oficial falha). Enumerar
hosts às cegas precisa de uma lista bem mais completa/atualizada do que as
3 entradas testadas aqui — provavelmente teria que vir de uma lista mantida
ativamente pela comunidade (VodRecovery/TwitchRecover), não hardcoded a
partir de memória.

**Ação recomendada:** atualizar o design doc pra rebaixar a confiança na
seção B — ela funciona matematicamente, mas a viabilidade prática depende
de uma fonte de hosts que ainda não temos validada.

## 4. Harvesting de hosts de CDN + teste da hipótese "mirrored" (`04-cdn-host-harvest.sh`)

**Contexto:** um terceiro sugeriu (via o usuário) que, em vez de confiar numa
lista hardcoded de hosts, dá pra extrair os hosts **realmente ativos agora**
direto do master playlist de qualquer VOD pública existente — e que o CDN
seria um "pool espelhado" onde o path de uma VOD (derivado do hash) deveria
ser alcançável em **qualquer** host ativo, não só no que apareceu na
playlist dela.

**Coleta (10 VODs de `apofigeaa`):** 9 de 10 resolveram pro mesmo host
(`d3fi1amfgojobc.cloudfront.net`); 1 resolveu pra um host diferente
(`dgeft87wbj63p.cloudfront.net`). **Confirma que hosts variam mesmo dentro
do mesmo canal** — não são fixos por canal nem por conta, mas também não
parecem aleatórios a cada VOD (a maioria caiu no mesmo host).

**Teste da hipótese "mirrored" — REFUTADA para o caso testado.** Peguei o
path confirmado da VOD `2841524354`
(`85162296b4d7b239523d_apofigeaa_318044569575_1786285382`, host correto
`d3fi1amfgojobc.cloudfront.net`) e testei contra `dgeft87wbj63p.cloudfront.net`
— um host que estávamos vendo **ativo e servindo outra VOD real** naquele
exato momento. Resultado: **403**, não 200.

```
[200] d3fi1amfgojobc.cloudfront.net   ← host real dessa VOD
[403] dgeft87wbj63p.cloudfront.net    ← host ativo, mas não guarda ESSA VOD
```

**Conclusão prática:** a técnica de harvesting (extrair hosts de playlists
reais) é genuinamente melhor que uma lista hardcoded desatualizada — dá pra
gerar uma lista fresca a qualquer momento e ela reflete a infra atual. Mas
**"qualquer host ativo serve qualquer VOD" está refutado** — cada VOD parece
pinada a um host de armazenamento específico. Ou seja, harvesting +
probing continua sendo fundamentalmente **probabilístico** (quanto mais
hosts únicos coletados, maior a chance de acertar o certo), não uma
garantia. Uma heurística razoável emerge daqui: **priorizar o(s) host(s)
mais recente(s) do mesmo canal** como primeiro candidato (maioria bate),
antes de tentar hosts de canais não relacionados.

## 5. `archiveVideo` durante live real (`01-vod-discovery-query.sh princessmariaaaaa`)

**Canal testado:** `princessmariaaaaa`, confirmada ao vivo pelo usuário e
pela própria resposta (`stream.id: "316711750869"`,
`createdAt: "2026-08-24T18:10:01Z"`).

Resultado: `archiveVideo: null`, mesmo com `stream` populado (canal
genuinamente ao vivo). **Enfraquece a hipótese** do
[speculation-vod-discovery-archivevideo-fallback.md](../notes/speculation-vod-discovery-archivevideo-fallback.md) —
o campo existe no schema (confirmado antes), mas não vem preenchido pelo
menos nessa janela do início da stream. Não dá pra descartar de vez (pode
populars depois de X minutos/horas de broadcast, não testamos o timing),
mas já derruba a versão mais forte da hipótese ("um poll único no momento
da detecção já resolve") — na prática exigiria poll repetido ao longo da
live inteira, o que reduz a vantagem sobre simplesmente esperar o VOD
publicar depois via `videos()`.

## 6. Recuperação real confirmada — pool de hosts cross-channel encontra conteúdo que o caminho A não lista

**O achado mais importante de toda essa série de testes.**

Contexto: `princessmariaaaaa` estava ao vivo, mas `archiveVideo` e
`videos()` sempre voltaram vazios pra ela (mesmo depois de >1h de live) —
forte indício de conta com VOD storage desligado. Ou seja, um caso real de
"o caminho A não acha nada" — exatamente o cenário que o fallback B precisa
resolver.

Capturei `channelName`+`streamId`+`startedAt` dela (do mesmo jeito que a
Monitor faria, via GQL, sem login), calculei o hash, e testei contra o
**pool de hosts já harvestado de canais completamente não-relacionados**
(coletados nos testes 3 e 4, de `apofigeaa` e `fofuriaa`):

```
[403] vod-secure.twitch.tv
[403] d2nvs31859zcd8.cloudfront.net
[403] d3fi1amfgojobc.cloudfront.net   (host mais comum da apofigeaa)
[200] dgeft87wbj63p.cloudfront.net    (host raro, 1/10 VODs da apofigeaa)
[403] d1m7jfoe9zdc1j.cloudfront.net   (host da fofuriaa)
```

**200, com conteúdo real** — confirmei baixando o playlist: o
`#EXT-X-PROGRAM-DATE-TIME` do primeiro segment bate com o `createdAt` da
stream dela (delay de ~2s, plausível). Não é uma resposta 200 vazia ou
genérica, é a live dela de verdade.

### O que isso confirma

- **O caminho B funciona de verdade como recuperação independente do
  caminho A** — achou conteúdo de um canal que o GQL não lista nem uma VOD.
  Isso eleva bastante a confiança na seção B do design doc.
- **A hipótese "mirrored" não estava totalmente errada, só formulada de
  forma forte demais.** Não é "qualquer host ativo serve qualquer VOD" (já
  refutamos isso no teste 4, dentro do mesmo canal). É mais como: existe um
  **pool relativamente pequeno de storage nodes compartilhados por toda a
  plataforma**, cada VOD cai numa (ou poucas) dessas — e quanto maior o
  pool de hosts que você já harvestou, **de qualquer canal**, maior a
  chance de acertar. Ou seja, **não precisa ser host do mesmo canal** —
  contradiz a heurística que eu tinha proposto antes ("priorizar host
  recente do mesmo canal"). O que importa é o **tamanho do pool
  acumulado**, não a origem dele.
- **Também prova que o dado que a produção já captura é suficiente** —
  `streamId` da GQL (`stream.id`) + `startedAt` (`stream.createdAt`) +
  `channelName`, exatamente o que a `stream` table já persiste hoje, sem
  nenhum campo novo.

### Ressalva original — já resolvida

Esse teste foi feito com a stream ainda ao vivo; faltava confirmar
sobrevivência pós-live. **Resolvido no mesmo dia** (ver
[PENDING-princessmariaaaaa.md](./PENDING-princessmariaaaaa.md)): depois que
o canal ficou offline (`stream: null`, `videos(): []` confirmados), o mesmo
path continuou respondendo `200` — e melhor ainda, o playlist ganhou
`#EXT-X-ENDLIST` (ausente enquanto ao vivo) e mostrou a transmissão
**completa**: ~4h14min, 1528 segments, do início ao fim exato da live.
**Recuperação real e persistente confirmada**, não só acesso transitório
durante a live.

## Resumo — o que mudou no design original

1. **Ponto C (auth+playlist) confirmado sem ressalvas** — query raw
   funciona, sem persisted query hash.
2. **Ponto A (descoberta) confirmado funcional, mas o join precisa ser por
   proximidade de `createdAt`**, não por ID direto — `videos()` não expõe
   `stream_id`.
3. **Ponto B (CDN): CONFIRMADO como recuperação real e persistente,
   independente do caminho A.** Fórmula do hash confirmada 3x (2 reversas,
   1 preditiva). Hipótese "mirrored" forte (qualquer host serve qualquer
   VOD) refutada, mas uma versão mais fraca se sustentou: existe um pool
   compartilhado de storage nodes, e um pool de hosts harvestados **de
   qualquer canal** — não precisa ser do mesmo canal — achou e recuperou a
   transmissão **completa** (~4h14min, do início ao fim) de um canal sem
   nenhuma VOD listada pela API oficial, **inclusive depois da live
   terminar**. Não é mais teoria — é recuperação ponta a ponta validada.
4. **`archiveVideo` existe no schema, mas não confirmado útil** — vem
   `null` numa live real testada ~minutos após o início. Rota alternativa
   perde força; não promover a plano principal sem mais teste de timing.
