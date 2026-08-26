# Design: download de VODs (recuperação de streams gravadas)

**Status:** implementado (2026-08-25) — ver "Fatiado — v1 implementado"
abaixo. Este documento captura o raciocínio de desenho discutido
antes/durante a implementação. A seção D (execução do download) foi
reescrita depois da v1 pra ficar retomável entre boots — ver
[ADR 006](../decisions/006-vod-download-child-process-resumable.md) pro
raciocínio completo dessa segunda fatia; o texto da seção D abaixo já
reflete o desenho atual, não o da v1 original.

## Fatiado — v1 implementado

Implementação faseada em 4 issues do Linear (CAI-74 a CAI-77), construída
em cima de uma primeira fatia (B+D+E) que veio antes delas. Todas as
partes descritas neste documento (A, B, C, D, E e o harvesting de hosts)
estão implementadas:

- **A (descoberta oficial)** — `LinkVodUseCase` + `VodLinker`, job
  periódico que casa `videos()` do GQL com `stream.startedAt` por
  proximidade (não por ID direto — ver seção A) e popula `stream.vodId` +
  `vodLookupStatus`.
- **B (recuperação via CDN)** — `resolveViaCdn`
  (`infrastructure/cdn-recovery`), reconstrução determinística do path via
  hash SHA1, probing contra um pool de hosts.
- **C (auth/playlist oficial)** — `resolveViaOfficial`
  (`infrastructure/official-vod`): `videoPlaybackAccessToken` via GQL +
  usher + seleção de variante por `channel.qualityPref`, com fallback pra
  próxima qualidade disponível.
- **Orquestração (A/C → B)** — `DownloadVodUseCase` tenta o caminho
  oficial primeiro quando `stream.vodId` já existe (melhor qualidade,
  não contorna controle de acesso); cai pro CDN só se o oficial não
  resolver.
- **D (execução do download)** — `HttpVodDownloader`
  (`infrastructure/downloader`), pool de segments, retry, eventos no bus.
  **Reescrita depois da v1** (mesmo dia, 2026-08-25) pra virar um
  despachante que spawna child process por download — ver "D. Execução do
  download" abaixo (já atualizada) e [ADR 006](../decisions/006-vod-download-child-process-resumable.md).
- **E (persistência)** — `DrizzleDownloadRepository`, índice único
  parcial pra idempotência sob concorrência.
- **Harvesting de hosts** — tabela `cdn_host` (Drizzle), seedada no boot
  do daemon via `seedKnownCdnHosts` (`infrastructure/cdn-recovery/known-hosts.ts`,
  os mesmos hosts já confirmados empiricamente, idempotente — seguro
  chamar em todo boot). Crescimento é **orgânico**: toda resolução
  bem-sucedida (via B ou C) grava o host que funcionou (`DownloadVodUseCase`,
  best-effort — falha ao gravar não derruba o download). Substituiu a
  antiga lista estática em `infrastructure/cdn-recovery/host-pool.ts`
  (removida).
  **Nota de crescimento futuro:** esse mecanismo só cresce com o *uso* do
  próprio daemon — canais que ele nunca tenta baixar não contribuem host
  nenhum. Se um dia isso se mostrar insuficiente (pool pequeno demais,
  taxa de acerto do fallback B caindo), o próximo passo natural é
  harvesting **ativo**: um job que sai testando VODs de canais quaisquer
  (mesma técnica do spike `apps/daemon/spikes/04-cdn-host-harvest.sh`) pra
  engordar o pool além do que o uso orgânico descobre sozinho. Não
  implementado — só registrado aqui como extensão possível.

## Problema

O daemon grava lives ao vivo (`streamlink`, ver [ADR 004](../decisions/004-streamlink-subprocess.md)),
mas nem toda stream é capturada ao vivo — o daemon pode estar offline no
momento, a gravação pode falhar, ou o operador pode só querer recuperar uma
stream antiga sem ter acompanhado ao vivo. A premissa deste desenho: já
registramos `channelName`, `streamId` e `startedAt` de toda stream que o
Monitor já viu ao vivo (tabela `stream`), e esses três dados são exatamente
o que se precisa pra localizar e baixar o VOD correspondente depois — seja
pelo caminho oficial da Twitch, seja por recuperação direta na CDN quando o
caminho oficial falha.

A tabela `download` já existe no schema, dormente — mesma situação que a
tabela `recording` estava antes de ser ligada.

## Correção de contexto encontrada durante este desenho

Documentos existentes ([ADR 004](../decisions/004-streamlink-subprocess.md),
[overview.md](../architecture/overview.md),
[recording-twitch-streams.md](../../apps/daemon/notes/recording-twitch-streams.md))
descrevem o Monitor como usuário de um "app access token da Helix"
(`client_credentials`, ~60 dias). **Isso não corresponde ao código real.**
[client.ts](../../apps/daemon/src/infrastructure/twitch/client.ts) e
[gql.ts](../../apps/daemon/src/infrastructure/twitch/http/gql.ts) mostram
que o Monitor usa o GQL não-documentado da Twitch (`gql.twitch.tv/gql`) com
o `Client-Id` público do client web (`kimne78kx3ncx6brgo4mv6wki5h1ko`) — sem
registro de app, sem secret, sem token de `client_credentials`. Não há
Helix oficial em uso em lugar nenhum do projeto hoje.

Isso importa pra este desenho porque significa que **não existe app
registrado na Helix disponível** — a descoberta de VOD (seção A) precisa
continuar no mesmo GQL não-documentado, não pode assumir o endpoint oficial
`Get Videos` da Helix. Os três documentos foram corrigidos (2026-08-24)
pra descrever a credencial real do monitor (`Client-Id` público do GQL,
sem ciclo de vida) em vez do "app token da Helix" inexistente.

## Requisitos e não-requisitos

**Requisitos:**

- Vincular uma `stream` já registrada ao seu `vodId` quando o VOD ficar
  disponível.
- Estado terminal quando o VOD nunca aparece — não pode ficar tentando pra
  sempre (mesmo princípio do [doc 001](001-teto-de-gravacoes-simultaneas.md)
  aplicado a outro tipo de órfão).
- Token de reprodução (`videoPlaybackAccessToken`) sempre buscado fresco no
  momento do download, nunca armazenado — mesma premissa da ADR 004, agora
  aplicada ao token de VOD em vez de live.
- Seleção de qualidade baseada em `channel.qualityPref` (já existe no
  schema), com fallback pra próxima melhor disponível se a qualidade pedida
  não existir naquele VOD específico.
- Fallback de recuperação via CDN quando o caminho oficial (GQL) falha ou
  nega acesso (VOD sub-only, deletado, ou nunca publicado) — **escopo
  confirmado explicitamente pelo usuário em 2026-08-24**, depois de
  ponderar que a técnica contorna um controle de acesso posto de propósito
  pela Twitch/streamer.
- Downloader HTTP próprio (sem `streamlink`) — busca segments na ordem
  certa, concatena, trata falha transiente por segment individual com
  retry.
- Teto de downloads simultâneos (mesmo tipo de problema do
  [doc 001](001-teto-de-gravacoes-simultaneas.md), instância nova) e
  concorrência controlada de segments dentro de um único download.
- Idempotência via constraint real no banco (ver seção de Riscos — motivo
  pelo qual isso diverge do doc 001).
- Reusa `storagePath` já calculado pelo `MediaStorage` pra cada stream — não
  cria árvore de artefato paralela.
- Saída em `.ts`, alimentando o mesmo job futuro de rewrap pra MP4 já citado
  no roadmap do projeto — um pipeline de conversão, não dois.

**Não-requisitos (fora de escopo agora):**

- Recuperar VODs de canais que o daemon nunca monitorou. O app só tem
  `streamId`/`startedAt` confiáveis dos canais que ele mesmo acompanhou —
  não há intenção de virar um serviço de descoberta genérico.
- Consultar sites de terceiros (TwitchTracker, SullyGnome) pra obter
  `streamId`/`startedAt`. Desnecessário: o próprio app já é a fonte desses
  dados pros canais que monitora (ver
  [past conversations/Claude-Voddownloader website inquiry](../../past%20conversations/Claude-Voddownloader%20website%20inquiry-20260824-1534.md),
  mensagem de 7/7/2026 3:40).
- Distribuir o teto de downloads entre múltiplas instâncias do daemon —
  mesmo não-requisito do doc 001, daemon continua single-node.
- Fila com priorização entre downloads — rejeição simples quando o teto
  está cheio.

## Abordagem proposta

### A. Descoberta e vínculo do VOD

Job periódico (`VodLinkerJob` ou nome equivalente), com cadência própria —
**mais lenta que o tick de ~30s do Monitor**, já que VOD leva tempo pra
processar depois do fim da live. Fluxo:

1. Busca streams com stream finalizada e `vodLookupStatus = pending` (campo
   novo, não reaproveitar `RecordingStatus` — é uma dimensão diferente do
   ciclo de vida).
2. Consulta o GQL da Twitch: `user(login) { videos(first: N, type: ARCHIVE) { edges { node { id createdAt lengthSeconds } } } }`.
   **Validado empiricamente em 2026-08-24** contra `apofigeaa` (ver
   [spikes/FINDINGS.md](../../apps/daemon/spikes/FINDINGS.md#1-descoberta-de-vod-01-vod-discovery-querysh)) —
   funciona como query raw, sem persisted query. **Revisão importante**: essa
   query **não expõe o `stream_id` do broadcast**, só o `id` do próprio VOD,
   `createdAt` e `lengthSeconds`. Então o match com a `stream` já persistida
   não pode ser por join direto de ID — precisa ser por **proximidade de
   `createdAt` × `stream.startedAt`** do mesmo `channelName` (mesmo canal,
   timestamps próximos, dentro de uma tolerância pequena de segundos).
3. Se achar: grava `stream.vodId`, marca `vodLookupStatus = linked`.
4. Se não achar e ainda dentro da janela de timeout (proposta: 48h desde o
   fim da stream): mantém `pending`, tenta de novo no próximo tick.
5. Se expirar a janela sem achar: tenta o fallback de recuperação via CDN
   (seção B) antes de desistir de vez.
6. Se o fallback também falhar: marca `vodLookupStatus = unavailable`
   (estado terminal — o job para de tentar essa stream).

Existe uma rota alternativa especulativa — capturar o `vodId` **durante a
própria live** via um possível campo `archiveVideo { id }` no `stream` do
GQL, o que eliminaria a necessidade do job pós-live inteiramente. Não
validado, documentado separadamente como plano B em
[apps/daemon/notes/speculation-vod-discovery-archivevideo-fallback.md](../../apps/daemon/notes/speculation-vod-discovery-archivevideo-fallback.md) —
só perseguir se esta abordagem principal (passos 1-6 acima) se mostrar
inviável.

### B. Recuperação via CDN (fallback)

Técnica usada por ferramentas da comunidade (TwitchRecover, VodRecovery):
reconstrução determinística da URL do VOD na CDN a partir de dados que **já
temos persistidos**, sem precisar de `vodId` nem de token algum:

```
hashable = f"{channelName}_{streamId}_{startedAt_unix}"
urlhash  = sha1(hashable).hexdigest()[:20]
url      = f"https://{cdn_host}/{urlhash}_{hashable}/chunked/index-dvr.m3u8"
```

- `streamId` aqui é o ID do **broadcast** (o mesmo que já vai em
  `stream.streamId`), **não** o `vodId` de `twitch.tv/videos/...`.
- `startedAt` precisa de precisão de segundo — confirmado que
  `stream.startedAt` já vem de `user.stream.createdAt` reportado pela
  própria Twitch (ver [monitor.ts:82](../../apps/daemon/src/infrastructure/monitor/monitor.ts#L82)),
  não de `Date.now()` local, então a precisão já está garantida pelo código
  atual — nenhuma mudança necessária aí.
- **Fórmula do hash confirmada empiricamente em 2026-08-24** (ver
  [spikes/FINDINGS.md](../../apps/daemon/spikes/FINDINGS.md#3-reconstru%C3%A7%C3%A3o-via-cdn-02-cdn-reconstructionsh)):
  recalculado localmente contra uma URL de CDN real (extraída do master
  playlist de um VOD confirmado), o SHA1 bateu caractere por caractere.
  A fórmula em si está correta.
- **Mas o `cdn_host` é o elo fraco, confirmado na prática.** No mesmo teste,
  o host real (`d3fi1amfgojobc.cloudfront.net`) não bateu com **nenhum**
  dos 3 hosts candidatos testados (`vod-secure.twitch.tv` e duas variantes
  de CloudFront). O host parece ser atribuído por broadcast/CDN-node, não
  vir de um pool pequeno e estável.
- **Técnica de harvesting testada (2026-08-24, `04-cdn-host-harvest.sh`):**
  extrair hosts reais de playlists de VODs existentes (em vez de confiar em
  lista hardcoded) é viável e gera candidatos frescos. Testado com 10 VODs
  de um mesmo canal: 9 caíram no mesmo host, 1 caiu num host diferente —
  hosts variam mesmo dentro do mesmo canal, mas não aleatoriamente a cada
  VOD.
- **Hipótese "CDN é um pool espelhado" na forma forte (path de uma VOD
  alcançável em QUALQUER host ativo) — testada e REFUTADA.** O path
  confirmado de uma VOD retornou 200 só no seu host real; testado contra
  outro host simultaneamente ativo servindo uma VOD *diferente* real,
  retornou 403. Cada VOD não está em todo lugar.
- **Mas uma versão mais fraca da hipótese se sustentou, e essa é a
  descoberta central desta seção: existe um pool compartilhado (não
  gigante) de storage nodes usados pela plataforma inteira, e um pool
  grande o suficiente de hosts harvestados — de QUALQUER canal, não
  precisa ser do mesmo — tem chance real de conter o host certo pra uma
  VOD de um canal totalmente não relacionado.** Confirmado em 2026-08-24:
  peguei `channelName`+`streamId`+`startedAt` de um canal ao vivo sem
  nenhuma VOD listada pela API (`princessmariaaaaa`, indício de VOD storage
  desligado — o caso real que este fallback existe pra cobrir), testei
  contra um pool de 5 hosts harvestados de dois canais **diferentes** dela,
  e um deles (harvestado da `apofigeaa`) devolveu 200 com conteúdo real
  confirmado (playlist com timestamps batendo com o início da stream dela).
  **É a primeira prova de recuperação de conteúdo que o caminho A
  genuinamente não encontra.** Detalhes completos em
  [spikes/FINDINGS.md §6](../../apps/daemon/spikes/FINDINGS.md#6-recupera%C3%A7%C3%A3o-real-confirmada--pool-de-hosts-cross-channel-encontra-conte%C3%BAdo-que-o-caminho-a-n%C3%A3o-lista).
  **Confirmado também pós-live** (mesmo dia): depois do canal ficar offline
  de verdade, o mesmo path continuou respondendo `200` e o playlist passou
  a ter `#EXT-X-ENDLIST` com a transmissão **completa** (~4h14min, 1528
  segments, início ao fim) — não é acesso transitório durante a live, é
  recuperação persistente de verdade. Ver
  [spikes/PENDING-princessmariaaaaa.md](../../apps/daemon/spikes/PENDING-princessmariaaaaa.md)
  (apesar do nome do arquivo, o resultado final está lá: **resolvido,
  confirmado**).
  Isso também revisa a heurística de mitigação: **não é "priorizar host do
  mesmo canal"** (não precisou disso aqui) — é **acumular o maior pool de
  hosts possível, de qualquer canal**, e testar contra ele. Ver Risco #5,
  revisado.
- Sem GQL, sem token — é HTTP GET/HEAD puro contra a CDN, uma vez que se
  tenha um host candidato.
- **Best-effort, não garantia.** Relatos da comunidade (dez/2025) indicam
  queda de confiabilidade depois de mudanças na CDN da Twitch. Desenhar
  como tentativa disparada cedo (logo após o timeout da descoberta oficial,
  ou em paralelo a ela), não como "rede de segurança garantida por 60
  dias".
- Segments "muted" (copyright) podem exigir reescrita do playlist pra
  remover o sufixo `-muted` das URLs — tratar como refinamento posterior,
  não bloqueante pra v1.
- **Nota de escopo — reforçada após confirmação empírica.** Isso deixou de
  ser capacidade teórica: em 2026-08-24 recuperamos, de ponta a ponta, a
  transmissão completa (~4h14min) de uma streamer real cujo canal
  aparentemente tem VOD storage desligado — ou seja, uma escolha dela de
  não reter transmissões passadas foi efetivamente contornada. Escopo
  confirmado pelo usuário para uso de arquivamento pessoal (2026-08-24,
  ver também a pergunta explícita sobre esse ponto mais cedo na mesma
  discussão). Vale reafirmar: essa capacidade, agora comprovadamente
  funcional, não deve ser usada pra recuperar transmissões de streamers que
  desabilitaram VOD storage por preferência de privacidade, fora do
  contexto de arquivamento pessoal já acordado. Se o uso do projeto algum
  dia se ampliar além disso (outros usuários, escala, distribuição),
  revisitar essa decisão conscientemente antes de prosseguir.

### C. Autenticação e resolução da URL (caminho oficial, quando `vodId` existe)

- Token (`videoPlaybackAccessToken`) buscado fresco a cada download via GQL,
  nunca armazenado — mesma premissa da ADR 004, aplicada ao token de VOD.
- Resolve o master playlist devolvido pra variante de qualidade baseada em
  `channel.qualityPref`; fallback pra próxima melhor disponível se a
  qualidade pedida não existir naquele VOD.
- **Confirmado ponta a ponta em 2026-08-24** contra um VOD público real (ver
  [spikes/FINDINGS.md](../../apps/daemon/spikes/FINDINGS.md#2-playbackaccesstoken--usher-03-playback-access-tokensh)):
  query GQL **raw** (texto puro, sem persisted query/hash sha256) →
  `videoPlaybackAccessToken` válido → usher devolveu master playlist
  completo com as 5 variantes de qualidade esperadas (1080p/720p/480p/360p/
  audio_only). A resposta do token também expõe `chansub.restricted_bitrates`
  e `authorization.forbidden`, então dá pra detectar VOD sub-only só pela
  resposta do token, sem precisar tentar baixar antes. Risco de hash de
  persisted query (mencionado nas versões anteriores deste doc) não se
  aplica a este endpoint, pelo menos hoje.

### D. Execução do download

**Atualizado (2026-08-25, segunda fatia) — ver [ADR 006](../decisions/006-vod-download-child-process-resumable.md)
pro raciocínio completo.** A v1 rodava HTTP assíncrono dentro do próprio
processo do daemon, sem child process. Reescrito pra ficar retomável entre
boots:

- `infrastructure/downloader/` (`HttpVodDownloader`) é agora um
  **despachante central**: spawna um child process "burro" por download
  (`Bun.spawn`, código próprio via `infrastructure/vod-executor/executor-entrypoint.ts`)
  — mesmo padrão de `infrastructure/recorder/` pro streamlink (ADR 004),
  só que rodando código nosso em vez de um binário de terceiros.
- Protocolo de 5 mensagens NDJSON entre pai e filho pela stdin/stdout
  (`infrastructure/vod-executor/protocol.ts`), reaproveitando o framing
  (`encodeMessage`/`LineBuffer`) de `@repo/ipc`.
- Pool de download de segments dentro do executor (concorrência
  configurável via `segmentConcurrency`), com buffer de reordenação já que
  a escrita final precisa respeitar a ordem do playlist mesmo se a rede
  responder fora de ordem. Retry por segment individual antes de reportar
  falha.
- Cursor durável `(segmentIndex, byteOffset)` reportado periodicamente
  (mensagem `progress`) e persistido no `download` **depois** dos bytes
  em disco — permite truncar e retomar exatamente de onde parou depois de
  um restart do daemon (`ResumeOrphanedDownloadsUseCase`, disparado no
  boot).
- Eventos no bus espelhando `RecordingFinished`/`RecordingFailed`:
  `DownloadFinishedEvent`, `DownloadFailedEvent`, publicados pelo
  despachante quando o executor reporta `done`/`failed`.

### E. Persistência e ciclo de vida

- `DrizzleDownloadRepository`, espelhando `DrizzleRecordingRepository`.
- `progress` = `segmentsBaixados / totalSegments` — valor exato, não
  estimativa, já que o total de segments é conhecido assim que o playlist é
  resolvido.
- `storagePath` reusa `MediaStorage.createStreamPath` — mesma pasta da
  stream, sem árvore de artefato separada.
- Saída em `.ts`, mesmo formato bruto do `StreamRecorder` — alimenta o
  mesmo job futuro de rewrap pra MP4.

## Riscos e trade-offs

1. ~~Nomes/hashes exatos de query GQL não confirmados~~ **Resolvido em
   2026-08-24** — descoberta (seção A) e `PlaybackAccessToken` (seção C)
   validados empiricamente, ambos funcionam como query GQL raw, sem
   persisted query. Ver [spikes/](../../apps/daemon/spikes/). GQL continua
   não-documentado oficialmente e pode mudar sem aviso — revalidar se muito
   tempo passar antes de confiar de novo nesses resultados.
2. **Confiabilidade da recuperação via CDN caiu** desde ~dez/2025 segundo
   relatos da comunidade. Não desenhar como garantia — é um fallback
   best-effort, não a espinha dorsal do fluxo.
3. **Zona cinzenta de ToS**: a recuperação via CDN contorna controles de
   acesso que a Twitch/streamer impôs de propósito. Escopo confirmado pelo
   usuário pra uso de arquivamento próprio (2026-08-24) — registrado aqui
   pra não se perder o contexto da decisão se o projeto crescer.
4. **Divergência proposital do padrão de idempotência do doc 001**: lá, a
   checagem antecipada (`hasCapacity()` no topo do use case, sem lock
   atômico) bastou porque o `ChannelMonitor` é comprovadamente sequencial —
   só um gatilho de `StartRecordingUseCase` existe. Aqui, os dois gatilhos
   propostos (job de descoberta rodando periodicamente + comando manual do
   operador) **não** têm essa garantia de serialização entre si. Por isso a
   idempotência aqui precisa de constraint real no banco (índice único
   parcial) desde o início, não de uma checagem antecipada simples — não é
   inconsistência de critério, é a mesma lógica do doc 001 aplicada a um
   cenário de concorrência genuína.
5. **Múltiplos hosts de CDN candidatos — risco real, mas com mitigação
   agora validada empiricamente.** Lista hardcoded de 3 hosts: 0/1 acerto.
   Harvesting de hosts de playlists reais: viável, gera candidatos frescos.
   A hipótese "qualquer host ativo serve qualquer VOD" foi refutada dentro
   do mesmo canal — mas **um pool de hosts harvestados de canais
   diferentes já encontrou conteúdo real de um canal sem nenhuma VOD
   listada** (2026-08-24, ver
   [FINDINGS.md §6](../../apps/daemon/spikes/FINDINGS.md#6-recupera%C3%A7%C3%A3o-real-confirmada--pool-de-hosts-cross-channel-encontra-conte%C3%BAdo-que-o-caminho-a-n%C3%A3o-lista)).
   Conclusão revisada: o fallback continua **probabilístico** na taxa de
   acerto (sobe com o tamanho do pool de hosts, não é garantia), mas está
   **confirmado como recuperação real e persistente**, não só teoria
   matemática — inclusive depois da live terminar (recuperação completa de
   ~4h14min confirmada pós-offline). Estratégia validada: acumular um pool
   de hosts harvestados **de qualquer canal** (não precisa ser do mesmo
   canal da VOD-alvo) e testar contra ele — ao contrário do que uma versão
   anterior deste documento propunha (priorizar host do mesmo canal), isso
   não se mostrou necessário no teste real.
   **Mitigação implementada (2026-08-25):** deixou de ser manual — a
   tabela `cdn_host` cresce organicamente a cada resolução bem-sucedida
   (ver "Fatiado — v1 implementado"). Continua sendo só uma versão
   passiva do harvesting; a extensão ativa (probing de canais quaisquer)
   segue como possibilidade futura registrada, não implementada.

## Plano

1. Adicionar `vodLookupStatus` (`pending` | `linked` | `unavailable`) ao
   schema `stream` — migração Drizzle.
2. ~~Validar empiricamente a query GQL de descoberta de VOD~~ **Feito
   (2026-08-24)** — ver [spikes/01-vod-discovery-query.sh](../../apps/daemon/spikes/01-vod-discovery-query.sh)
   e [FINDINGS.md](../../apps/daemon/spikes/FINDINGS.md).
3. Implementar `VodLinkerUseCase`/job: consulta GQL (`videos(type: ARCHIVE)`,
   match por proximidade de `createdAt`/`startedAt`, não por ID direto —
   revisão do passo 2), timeout de 48h, transição `pending` →
   `linked`/`unavailable`, disparando o fallback de CDN (passo 4) antes do
   estado terminal.
4. Implementar a reconstrução via CDN (hash SHA1 confirmado + probe HTTP)
   como função isolada, testável sem rede real via fake HTTP client.
   Estratégia de host validada empiricamente (Risco #5): manter um pool
   acumulado de hosts harvestados de VODs quaisquer (não precisa ser do
   mesmo canal da stream-alvo — confirmado que host cross-channel também
   encontra conteúdo real) e testar o path contra todo o pool — quanto
   maior o pool, maior a chance de acerto. Continua probabilístico, não é
   garantia.
5. Ligar `DrizzleDownloadRepository`, com índice único parcial
   (`UNIQUE(stream_id) WHERE status IN ('queued','downloading')`) pra
   idempotência sob os dois gatilhos.
6. ~~Validar empiricamente a persisted query `PlaybackAccessToken`~~ **Feito
   (2026-08-24)** — confirmado que funciona como query raw, sem persisted
   query. Ver [spikes/03-playback-access-token.sh](../../apps/daemon/spikes/03-playback-access-token.sh).
7. Implementar `VodDownloader` (`infrastructure/downloader/`): pool de
   segments, retry por segment, eventos no bus.
8. `DownloadVodUseCase`: checa teto de capacidade, resolve token+playlist
   (via `vodId` oficial se existir, senão via CDN), persiste `download` row,
   dispara `VodDownloader`.
9. Novo comando IPC (`download-vod`, nome a confirmar) espelhando
   `start-record`/`stop-record`.
10. Testes: unit (use cases com fakes), integration cobrindo especificamente
    o requisito que diverge do doc 001 — dois gatilhos concorrentes contra o
    mesmo `streamId` não podem gerar dois downloads simultâneos.
11. Sem migração de dados retroativa além da nova coluna — streams antigas
    entram como `pending` automaticamente no primeiro tick do job de
    descoberta.
