# Módulo `twitch` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha o único módulo que fala com a superfície privada da Twitch. Ainda **language-agnostic**: descreve a interface pública e a lógica das sub-rotinas, não a implementação em Node/Go. Os fatos concretos (URLs, fórmula do hash, Client-ID) estão aqui porque são a parte "congelada" do design; a parte **volátil** está isolada de propósito (seção 6 deste spec).

---

## 1. Papel e princípio

O `twitch` transforma *"quero este conteúdo"* em *"aqui está um manifesto HLS tocável/baixável"*, cobrindo os caminhos 1 e 2 de aquisição (acesso legítimo e bypass pela CDN) e fornecendo o manifesto **ao vivo** que o `recorder` usa (caminho 3).

É o **único módulo frágil** — a Twitch troca hash de persisted query, adiciona headers exigidos e muda hosts de CDN sem aviso. Todo o design gira em torno de **isolar essa volatilidade**: o que quebra fica num único lugar patchável, o resto do motor nunca vê.

**Move de design central:** as três rotas retornam o **mesmo tipo `Manifest` normalizado**. Quem chama (`recorder`, `downloader`) não sabe nem se importa de qual caminho o manifesto veio — recebe "um m3u8 mestre + um contexto de auth" e segue. A rota de aquisição é invisível downstream.

---

## 2. Interface pública (language-agnostic)

| Função | Entrada | Saída | Usada por |
|---|---|---|---|
| `getLiveMetadata(channelLogin)` | login do canal | `StreamMeta` \| `NotLive` | `monitor` |
| `resolveLiveManifest(channelLogin, opts)` | login + qualidade | `Manifest` \| `NotLive` | `recorder` |
| `resolveVodManifest(vodId, opts)` | id do VOD publicado | `Manifest` \| `Forbidden` \| `NotFound` | `downloader` (caminho 1) |
| `recoverVodManifest(login, streamId, startedAt, opts)` | metadata da stream | `Manifest` \| `NotOnCdn` | `downloader` (caminho 2) |
| `parseManifest(masterBody)` | m3u8 mestre | `QualityVariant[]` | interno / `downloader` |
| `selectQuality(variants, pref)` | variantes + preferência | `QualityVariant` | `recorder`, `downloader` |
| `unmuteMediaPlaylist(mediaBody)` | m3u8 de mídia | m3u8 reescrito | `downloader` |

A função `Forbidden` vs `NotOnCdn` vs `NotFound` como retornos distintos importa: é o que deixa o **resolver** (seção 5 deste spec) decidir o próximo caminho sem adivinhação.

---

## 3. Tipos

```
Manifest {
  source       : 'live' | 'authenticated' | 'cdn-recovery'  -- mapeia opções 3/1/2
  variants     : QualityVariant[]
  authContext  : AuthContext           -- headers/cookies a repassar aos segmentos
  muted        : bool                  -- true se há segmentos -muted (caminho VOD)
}

QualityVariant {
  name             : string            -- '1080p60', '720p30', 'chunked' (=source)
  bandwidth        : int
  mediaPlaylistUrl : string
}

StreamMeta {
  channelLogin : string
  streamId     : string
  startedAt    : int                   -- unix UTC em segundos (alimenta o hash)
  title        : string
  game         : string
}

AuthContext {
  clientId : string                    -- web client público
  cookies  : string?                   -- só no caminho 1
  headers  : map                       -- ex.: Client-Integrity quando exigido
}
```

---

## 4. Sub-rotinas

### A. Token dance (`PlaybackAccessToken` via persisted query)

Base comum dos caminhos 1 e do ao-vivo. Fatos congelados:

- `POST https://gql.twitch.tv/gql`
- Header `Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko` (web client público, não é segredo nem seu) + opcionalmente cookies/`Authorization: OAuth <token>` no caminho 1.
- Body com **persisted query**: `operationName: PlaybackAccessToken_Template`, `extensions.persistedQuery.sha256Hash = <HASH_VOLÁTIL>`, e `variables` que mudam entre live e vod.
- Resposta: `{ value, signature }`. O `value` é um JSON com `authorization.forbidden`, `expires`, etc.

Divergência **live vs vod** (a parte que confunde):

| | VOD | Live |
|---|---|---|
| `variables` | `{ isLive:false, isVod:true, vodID, playerType:'site' }` | `{ isLive:true, isVod:false, login:channel, playerType:'site' }` |
| endpoint usher | `usher.ttvnw.net/vod/{vodId}?nauth={value}&nauthsig={sig}&allow_source=true&...` | `usher.ttvnw.net/api/channel/hls/{channel}.m3u8?token={value}&sig={sig}&allow_source=true&...` |
| manifesto | playlist fechada (tem `#EXT-X-ENDLIST`) | playlist rolante (sem `ENDLIST` até encerrar) |

O usher devolve o **m3u8 mestre** com as variantes de qualidade → `parseManifest`.

### B. Recovery por hash da CDN (caminho 2 — sem conta)

```
hashable_base = "{login}_{streamId}_{startedAt}"     -- startedAt = unix UTC (s)
urlhash       = SHA1(hashable_base) hex, primeiros 20 chars
path          = "/{urlhash}_{hashable_base}/chunked/index-dvr.m3u8"
```

Probe `HEAD path` contra a **lista de hosts de CDN** (config volátil, seção 6): `vod-secure.twitch.tv`, `d2nvs31859zcd8.cloudfront.net`, `dqrpb9wgowsf5.cloudfront.net`, … O primeiro que responde 200 vence → sintetiza um `Manifest` (`source: 'cdn-recovery'`) apontando pra esse host.

Cuidados que tornam isso robusto:
- **Precisão do timestamp:** `startedAt` tem que ser o segundo exato de início; trackers às vezes arredondam. Se o probe inicial falhar, tente uma **janela de ±N segundos** em volta do `startedAt`.
- `chunked/index-dvr.m3u8` é a qualidade source; outras qualidades são caminhos irmãos no mesmo prefixo.
- Janela física: ~7–60 dias. Fora dela, retorna `NotOnCdn` (e o resolver desiste ou cai pro caminho 1).

### C. Auth por cookie (caminho 1 — acesso legítimo)

- `cookies.txt` (formato Netscape, exportado do navegador logado) → anexado a gql + usher + CDN.
- Sub-only: se `authorization.forbidden == true`, a conta **não tem direito** → retorna `Forbidden` (o resolver tenta outro caminho). Se `false`, segue.
- O cookie carrega **identidade**, não autorização. Não é bypass — é "eu, logado, tenho direito". (O bypass real é a sub-rotina B.)

### D. Parse e seleção de qualidade

- Parsear o mestre: linhas `#EXT-X-STREAM-INF` (resolução + bandwidth) seguidas da URL do media playlist. `chunked` = source.
- `selectQuality`: `'best'` → maior bandwidth; valor específico → match exato ou mais próximo abaixo.

### E. Unmute de segmentos (caminho VOD)

- VODs com música detectada têm segmentos `*-muted.ts` no playlist, que quebram alguns players.
- `unmuteMediaPlaylist` reescreve essas URLs removendo o sufixo `-muted` — o arquivo sem áudio mutado geralmente ainda existe no mesmo path. Marca `Manifest.muted = true` pra UI avisar.

---

## 5. O resolver (glue acima do módulo)

O **resolver unificado** da seção 8 da arquitetura **não vive dentro do `twitch`** — ele orquestra `twitch` + `store`, porque o primeiro passo é checar gravação própria (que é responsabilidade do `store`). O `twitch` fornece os tijolos; o resolver decide a ordem:

```
resolveContent(target):
  1. store.findRecording(target)          -> existe? usa (opção 3). melhor qualidade.
  2. twitch.recoverVodManifest(...)        -> != NotOnCdn? usa (opção 2). sem conta.
  3. twitch.resolveVodManifest(vodId, {cookies}) -> != Forbidden? usa (opção 1). legítimo.
  4. senão                                 -> Unavailable (o limite físico).
```

Deixar o resolver fora do `twitch` mantém o módulo focado em "falar com a Twitch" e testável de forma isolada.

---

## 6. Pontos de fragilidade e a estratégia (a parte que quebra)

Tudo o que a Twitch pode mudar sem aviso fica **isolado num único arquivo de config patchável** (`twitch_config.json`), nunca espalhado pelo código:

```
twitch_config.json {
  clientId          : "kimne78kx3ncx6brgo4mv6wki5h1ko",
  persistedQueries  : { playbackAccessToken: "<sha256 hash>" },   -- ROTA mais quebra
  cdnHosts          : [ "vod-secure.twitch.tv", "d2nvs31859zcd8.cloudfront.net", ... ],
  usher             : { vod: "...", live: "..." }                 -- templates de URL
}
```

Modos de falha e como o módulo reage:

| Sintoma | Causa provável | Reação do módulo |
|---|---|---|
| erro GQL em `PlaybackAccessToken` | hash da persisted query rodou | log claro `"persisted query stale — atualizar hash"`, não crash genérico |
| GQL exige `Client-Integrity` | endpoint protegido (ex.: lista de VODs do canal) | evitar esse endpoint — pegar metadata pelos **trackers** em vez do gql; integrity só se inevitável |
| 403 no usher/CDN | token expirou **ou** região/sub bloqueia **ou** hash velho | distinguir: re-pedir token (expirou) vs `Forbidden` (bloqueio) vs alerta de hash |
| recovery sempre falha num streamer | host de CDN novo não está na lista | lista de hosts é volátil — manter atualizável (projetos tipo TwitchRecover mantêm listas) |
| 429 | rate limit | backoff exponencial; cap de probes/segmentos (boa cidadania protege seu IP) |

**Regra operacional:** o `twitch` loga verboso *o que* falhou e *qual* config suspeita, porque o conserto quase sempre é "atualizar um valor no `twitch_config.json`", não reescrever lógica. Esse é o objetivo de todo o isolamento.

---

## 7. O que fica adiado

- **Adapter de Kick** atrás da mesma interface (`getLiveMetadata`/`resolve*` viram uma interface `Platform`, com `twitch` e `kick` como implementações).
- **Geração de `Client-Integrity`** (JWT de script ofuscado) — só se algum recurso além de playback exigir; começar evitando endpoints que pedem.
- **Fluxo OAuth real** — `cookies.txt` primeiro; OAuth só se a importação de cookie virar atrito.
- **Descoberta automática do hash** da persisted query (espionar devtools programaticamente) — no MVP, atualização manual no config basta.

---

*Spec do módulo `twitch` — versão inicial. As partes congeladas (seção 4) são estáveis; as voláteis (seção 6) são as que vão pedir manutenção.*
