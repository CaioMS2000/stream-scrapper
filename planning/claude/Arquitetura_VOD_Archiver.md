# Arquitetura — VOD Archiver local (MVP)

> Esqueleto de arquitetura para a ferramenta pessoal de arquivamento de Twitch (monitorar + gravar ao vivo + recuperar/baixar VOD + assistir). O objetivo deste documento é **fixar só o que é caro de mudar** — a fronteira, o contrato da API, o schema e o layout em disco — de um jeito que valha igual para um motor em Node hoje e um motor em Go amanhã.
>
> **Princípio de design:** o motor e a UI conversam só por uma API local. A linguagem de dentro do motor fica atrás desse contrato e vira um detalhe reversível. Tudo que a UI acopla (rotas, eventos, schema, formato em disco) é o que precisa de carinho *agora*; a escolha Node-vs-Go pode ser adiada de graça.

---

## 1. A decisão que se toma agora (e a que não se toma)

**Decidir agora (caro de mudar):**
- O contrato da API (seção 4) — é o que a UI acopla.
- O schema de dados (seção 5) — sobrevive a qualquer reescrita do motor.
- O layout em disco (seção 6) — sobrevive até à perda do banco.
- A regra de que **capturar + salvar é headless** (seção 7) — é o que garante que o motor roda sozinho.

**Não decidir agora (reversível):**
- A linguagem do motor (Node hoje; Go vira opção se virar "frota de gravação"). Reescrever o daemon contra o mesmo contrato é uma tarde, não um recomeço.
- ffmpeg direto vs `streamlink` como lib na gravação (detalhe do módulo `recorder`).
- UX de auth sub-only (importar `cookies.txt` vs fluxo OAuth) — começar com `cookies.txt`.
- Suporte a Kick (segundo adapter atrás da interface do módulo `twitch`).
- Empacotar como app clicável / ícone na bandeja (luxo de polimento, depois).

---

## 2. Componentes

**Motor (daemon local).** Processo de verdade (Node agora) que faz *todo* o trabalho pesado: fala com a Twitch, puxa HLS, roda ffmpeg, escreve arquivos no disco, mantém o índice e expõe a API. Precisa de coisas que uma aba de browser não tem: escrever arquivos arbitrários, spawnar processo filho e fazer requisições sem a algema do CORS.

**UI (painel).** SPA React servido pelo próprio motor e aberto no browser em `localhost:<porta>`. É um consumidor puro da API do motor — não fala com a Twitch diretamente. Inclui um `<video>` com hls.js apontado para o proxy do motor, para assistir o que está sendo gravado ao vivo.

**Externos.** Twitch (`gql.twitch.tv`, `usher.ttvnw.net`, CDN), agregadores de metadata (twitchtracker/streamscharts/sullygnome) e `ffmpeg` (binário nativo invocado como subprocesso).

---

## 3. A fronteira (o contrato language-agnostic)

A UI conhece o motor só por três planos:

- **Plano de controle** — REST/HTTP: comandos e leituras (adicionar monitorado, listar capturas, disparar download).
- **Plano de eventos** — WebSocket (ou SSE): o motor empurra atualizações em tempo real (live detectada, progresso de gravação, download concluído).
- **Plano de dados** — proxy HLS: o motor busca o manifesto/segmentos ao vivo (ele tem o token e o Client-ID, sem dor de CORS) e o hls.js do front aponta só para o `localhost`.

Enquanto esses três contratos não mudarem, o miolo do motor é trocável.

---

## 4. Contrato da API (plano de controle + eventos)

### REST (controle)

| Método | Rota | Faz |
|---|---|---|
| `GET` | `/api/streamers` | lista streamers monitorados |
| `POST` | `/api/streamers` | adiciona `{ login, auto_record?, quality_pref? }` |
| `PATCH` | `/api/streamers/:login` | edita (ex.: ligar/desligar `auto_record`) |
| `DELETE` | `/api/streamers/:login` | para de monitorar |
| `GET` | `/api/streams` | lista streams descobertas (filtros: `?streamer=`, `?status=`) |
| `GET` | `/api/streams/:streamId` | detalhe de uma stream |
| `POST` | `/api/streams/:streamId/probe` | refaz a URL da CDN e testa liveness (atualiza `cdn_status`) |
| `POST` | `/api/streams/:streamId/download` | enfileira download do VOD via CDN |
| `GET` | `/api/recordings` | lista gravações ao vivo (em andamento + concluídas) |
| `POST` | `/api/recordings/:id/stop` | encerra uma gravação em andamento |
| `GET` | `/api/downloads` | lista downloads de VOD (fila + histórico) |
| `POST` | `/api/downloads/:id/cancel` | cancela um download |
| `GET` | `/api/config` | lê configuração |
| `PUT` | `/api/config` | grava configuração (storage path, rate limit, cookies, qualidade default) |

### Eventos (WebSocket — `/api/events`)

Envelope único, fácil de versionar:

```json
{ "type": "recording.progress", "ts": 1750000000, "data": { } }
```

| `type` | `data` |
|---|---|
| `streamer.live` | `{ streamerLogin, streamId, startedAt, title, game }` |
| `stream.discovered` | `{ streamId, streamerLogin }` |
| `recording.started` | `{ recordingId, streamId, quality }` |
| `recording.progress` | `{ recordingId, durationSeconds, bytes }` |
| `recording.completed` | `{ recordingId, storagePath, bytes }` |
| `recording.failed` | `{ recordingId, error }` |
| `download.progress` | `{ downloadId, progress }` |
| `download.completed` | `{ downloadId, storagePath }` |
| `download.failed` | `{ downloadId, error }` |
| `probe.result` | `{ streamId, cdnStatus }` |

### Proxy HLS (plano de dados — para assistir)

| Método | Rota | Faz |
|---|---|---|
| `GET` | `/api/live/:login/playlist.m3u8` | motor busca o manifesto ao vivo (com token), reescreve as URLs dos segmentos para apontar de volta ao proxy, devolve ao hls.js |
| `GET` | `/api/live/:login/segment/:segId` | proxia um segmento `.ts` individual |

Regra de ouro do contrato: **nomes e formatos acima são o que a UI acopla.** O motor pode ser Node ou Go — quem responde em `localhost:<porta>` é detalhe; a UI vê JSON e eventos.

---

## 5. Schema de dados (SQLite — idêntico em Node ou Go)

A separação em duas tabelas de saída (`recordings` vs `downloads`) espelha as **duas janelas de aquisição**: gravação ao vivo (cópia própria, sobrevive à deleção) vs recuperação pós-fato pela CDN (best-effort, janela de ~7–60 dias).

```sql
CREATE TABLE streamers (
  login            TEXT PRIMARY KEY,
  display_name     TEXT,
  monitored_since  INTEGER,          -- unix ts
  auto_record      INTEGER DEFAULT 0,-- 0/1: grava sozinho ao subir
  quality_pref     TEXT DEFAULT 'best'
);

CREATE TABLE streams (
  stream_id        TEXT PRIMARY KEY,
  streamer_login   TEXT REFERENCES streamers(login),
  started_at       INTEGER,          -- unix ts UTC — alimenta o hash da CDN
  title            TEXT,
  game             TEXT,
  duration_seconds INTEGER,
  vod_id           TEXT,             -- nullable; se a Twitch publicou VOD
  cdn_status       TEXT DEFAULT 'unknown', -- unknown|recoverable|expired|muted
  last_probed_at   INTEGER
);

CREATE TABLE recordings (           -- captura ao vivo feita pelo motor
  id           TEXT PRIMARY KEY,
  stream_id    TEXT REFERENCES streams(stream_id),
  started_at   INTEGER,
  ended_at     INTEGER,
  status       TEXT,                -- recording|completed|failed
  quality      TEXT,
  storage_path TEXT,                -- relativo ao storage root
  bytes        INTEGER
);

CREATE TABLE downloads (            -- VOD pós-fato: acesso legítimo OU bypass CDN
  id           TEXT PRIMARY KEY,
  stream_id    TEXT REFERENCES streams(stream_id),
  source       TEXT,                -- authenticated (opção 1) | cdn-recovery (opção 2)
  status       TEXT,                -- queued|downloading|completed|failed
  progress     REAL DEFAULT 0,      -- 0..1
  storage_path TEXT,
  created_at   INTEGER
);
```

---

## 6. Layout em disco (sobrevive a qualquer reescrita)

```
<storage_root>/
  archive.db                         # índice SQLite
  config.json                        # config (ou dentro do banco)
  cookies.txt                        # auth sub-only — local, nunca versionar
  <streamer_login>/
    <stream_id>_<started_at>/
      meta.json                      # metadata denormalizada (auto-descritivo)
      recording.mp4                  # captura ao vivo (se gravado ao vivo)
      vod.mp4                        # download pós-fato (acesso legítimo ou bypass CDN)
      segments/                      # opcional: .ts crus durante a gravação
```

O `meta.json` por pasta torna cada arquivo **auto-descritivo**: mesmo perdendo o banco, a pasta diz o que ela é. É a âncora de resiliência que faz a reescrita do motor (e do schema) ser indolor.

---

## 7. Fluxo headless (capturar + salvar, sem passar pela UI)

Este caminho **nunca toca a UI** — é o que garante que o motor roda sozinho (e o que deixa a migração pra Go indolor):

1. O `monitor` pollia os streamers monitorados a cada N segundos (Helix `Get Streams` ou gql).
2. Streamer sobe → insere linha em `streams` (`stream_id`, `started_at`, `title`, `game`) → emite `streamer.live`.
3. Se `auto_record` ligado → `recorder` inicia job: pega `PlaybackAccessToken` (`isLive: true`) → manifesto de canal no usher → spawna ffmpeg/streamlink escrevendo `recording.mp4` (e/ou `segments/`) → insere `recordings` (status `recording`) → emite `recording.started`.
4. Job emite `recording.progress`; ao fim do stream (`#EXT-X-ENDLIST` ou ffmpeg encerra) → status `completed` → emite `recording.completed`.

A UI só **observa** isso via eventos; não está no caminho.

### Fluxo de recuperação de VOD (sob demanda, esse sim disparável pela UI)

1. `POST /api/streams/:id/probe` → `twitch` reconstrói a URL da CDN a partir de `streamer_login + stream_id + started_at` (hash SHA1) → HEAD nos hosts conhecidos de CDN → atualiza `cdn_status` → emite `probe.result`.
2. Se `recoverable` e o usuário dispara `download` → linha em `downloads` (`queued`) → `downloader` puxa o `index-dvr.m3u8` via ffmpeg → `vod.mp4` → emite `download.progress`/`download.completed`.

> Lembrete de produto: para **garantir** que algo sobreviva à deleção, o recovery não basta — tem que gravar ao vivo. O recovery é uma aposta contra o relógio de retenção da Twitch.

---

## 8. Mecanismos de aquisição (os três caminhos)

> A referência de produto deste MVP é, na prática, **dois produtos do mesmo dono fundidos num só**: o voddownloader (extensão que pega VOD por acesso próprio + bypass) e o streamrecorder (servidor que grava ao vivo). A meta é cobrir **tanto o que uma conta tem acesso natural quanto o que ela não tem**. Para isso o motor mantém três estratégias de aquisição independentes, cada uma com cobertura diferente.

| # | Caminho | Como funciona | Requer | Cobertura / janela | Módulo |
|---|---|---|---|---|---|
| 1 | Acesso legítimo | `gql` → token → `usher`, carregando `cookies.txt` | conta com direito real (sub do canal, próprio conteúdo, região) | qualquer VOD que a conta consegue ver na Twitch | `twitch` |
| 2 | Bypass pela CDN | reconstrói a URL por `stream_id + started_at` (hash SHA1) + HEAD probe | nada — o arquivo no bucket não checa inscrição | só VOD **recente** ainda na CDN (~7–60 dias; raríssimo após 7 pra não-parceiro) | `twitch` + `downloader` |
| 3 | Gravação ao vivo | puxa o HLS ao vivo e salva cópia própria | estar **monitorando antes** de ir ao vivo | só o que você gravou — mas sobrevive a deleção, sub-only e expiração | `recorder` |

**Reativo vs proativo (a distinção que decide o que cobre o quê):**
- **Opções 1 e 2 são reativas** — você aponta um VOD que já existe e o motor tenta buscá-lo agora.
- **Opção 3 é proativa** — só captura o que você decidiu gravar *antes* de acontecer. É a única que **garante** sobrevivência, mas não recupera passado que você não gravou.

Por isso a referência fundida: o `recorder` rodando proativo (você nunca perde o futuro dos canais que segue) **+** o resolver reativo (`cookies` + hash CDN) pra fisgar o passado sob demanda.

**Resolver unificado** — ao pedir um conteúdo específico, o motor tenta em ordem de confiabilidade e custo:
1. Já tenho **gravação ao vivo** disso? (opção 3, no acervo) → uso. Melhor qualidade, cópia completa, zero dependência da Twitch.
2. Senão, o arquivo **ainda está na CDN**? (opção 2) → recupero. Sem precisar de conta.
3. Senão, **minha conta tem acesso**? (opção 1, `cookies`) → pego pelo caminho legítimo. É o necessário pra sub-only que *não* está na CDN mas que eu de fato posso ver.
4. Senão → **indisponível**. Sub-only de canal onde não sou sub, já fora da CDN e que nunca gravei = irrecuperável. É o limite físico — nenhum dos três alcança.

**Por que seu exemplo funcionou sem você ser sub:** ao assistir um sub-only de canal onde você não é inscrito, a opção 1 não fez nada (você não tinha direito). Quem entregou foi a opção 2 (era recente, ainda na CDN) ou a opção 3 (o acervo de gravação ao vivo por trás da extensão). Confirma que o sub-only "impossível" vem do bypass/gravação, não do seu acesso.

**Nota sobre a opção 1 (por que `cookies.txt`):** uma *extensão* (voddownloader) herda sua sessão logada da Twitch automaticamente, porque roda dentro do navegador. Seu motor é um **daemon, não extensão**, então não herda nada — o `cookies.txt` é o substituto manual dessa sessão. É a única razão de ele existir; não é o que "destranca" sub-only de terceiros (isso é opção 2/3).

**Mapa pro schema (seção 5):** opção 3 → tabela `recordings`. Opções 1 e 2 → tabela `downloads`, distinguidas pelo campo `source` (`authenticated` = opção 1; `cdn-recovery` = opção 2).

---

## 9. Módulos internos do motor (responsabilidades language-agnostic)

A reescrita pra Go é "reimplementar estes módulos contra o mesmo contrato e schema":

| Módulo | Responsabilidade |
|---|---|
| `api` | expõe REST + WebSocket + proxy HLS |
| `events` | pub/sub interno que alimenta o WebSocket |
| `monitor` | loop de polling, detecção de live |
| `twitch` | token dance (vod/live), fetch de manifesto, hash/recovery da CDN, auth por cookie — implementa os **caminhos 1 e 2** (seção 8) |
| `recorder` | orquestra captura ao vivo (subprocesso ffmpeg/streamlink) — o **caminho 3** (seção 8) |
| `downloader` | baixa o VOD pós-fato (subprocesso ffmpeg, segmentos paralelos) — serve aos caminhos 1 e 2 |
| `store` | acesso ao SQLite + layout em disco |

O `twitch` é o único módulo com lógica frágil (a Twitch muda hash de persisted query e adiciona headers de tempos em tempos), então ele é o que mais precisa de logging bom e ser fácil de patchar — e é onde um futuro adapter de Kick se encaixa, atrás da mesma interface.

---

## 10. Sequência sugerida de construção

1. **Motor headless primeiro, sem UI.** Provar o caminho duro: `twitch` (token + manifesto + recovery) → `recorder` gravando uma live → `store` salvando + `meta.json`. É aqui que mora o risco real (a dança gql/CDN e a orquestração de segmentos), não na tela.
2. **CLI interina** (driver de teste) — assim que o motor tem funções chamáveis, uma casca CLI mínima mapeia subcomandos direto pras interfaces internas dos módulos (`addStreamer`, `startRecording`, `queueDownload`, `resolveContent`), **sem HTTP**. É o jeito de pilotar e exercitar o motor headless enquanto o React não existe — não é produto final, é andaime. (Ver nota abaixo.)
3. **Subir a `api`** (REST + eventos) por cima do motor já funcional.
4. **Painel React** consumindo a API: lista de monitorados, capturas, disparo de download.
5. **Proxy HLS + player** por último (a parte de "assistir ao vivo"), que é independente de tudo o resto.

> **Nota sobre a CLI:** ela é o **consumidor mais fino possível** do motor — mais fino que a própria `api`, porque não passa por HTTP nem serialização; chama as funções dos módulos diretamente. Por isso encaixa cedo (passo 2), antes da `api`, e serve de andaime de teste headless. Depois que a `api` sobe, a CLI pode continuar existindo como um segundo consumidor (batendo na REST ou no barramento de `events` — o `Modulo_Api_Events.md` §4 já a prevê como possível assinante), mas seu papel-âncora é ser o **driver interino** das fases iniciais. É a resposta pro "como eu uso isso antes da UI ficar pronta".

Construindo nessa ordem, a parte cara (contrato + schema + disco) fica fixada cedo, e a barata (linguagem do motor) continua adiável até você saber se isso vira "só seu" ou "frota de gravação".

---

*Documento de arquitetura — versão inicial do MVP. Evolua conforme as decisões forem se concretizando.*
