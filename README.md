# stream-scrapper

Daemon TypeScript de longa execução para monitoramento e captura de streams
ao vivo em plataformas públicas. Detecta transições online/offline por
polling de API pública, dispara `streamlink` como child process pra baixar
o `.ts` bruto, e mantém sidecar de metadados durável ao lado de cada
gravação. Controlado por um CLI separado que fala com o daemon via **unix
socket** — dois processos, um protocolo compartilhado, tipos ponta-a-ponta.

O escopo do domínio é intencionalmente pequeno — o valor do projeto está
nas **decisões arquiteturais** que aguentam o crescimento sem virar bola
de neve: hexagonal com dois driving adapters (IPC e EventBus), use cases
como unidade de intenção, IPC tipado com discriminated union do zod,
durabilidade em duas fontes (SQLite + sidecar JSON), 3 tiers de teste
com custos crescentes.

## Stack

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Bun 1.3 | `Bun.spawn` pra child processes, `bun:sqlite` nativo, TS sem transpiler no dev loop, `Bun.file`/`Bun.serve` como stdlib expandida |
| Persistência estruturada | SQLite via [Drizzle ORM 1.0-rc](https://orm.drizzle.team) | Migrations tipadas, SQL explícito quando precisa, zero runtime overhead — só typed query builder |
| Persistência durável de mídia | Filesystem + `meta.json` sidecar por gravação | Redundância intencional: DB é a fonte queryable, sidecar é a fonte auto-suficiente (`.mp4` + `meta.json` no mesmo dir) |
| Validação de I/O | [zod 4](https://zod.dev) | Discriminated unions no fio (schema.parse em input do socket, output da API externa) — compile-time + runtime alinhados |
| IPC entre processos | Unix domain socket + NDJSON framing | Um daemon + N clientes CLI concorrentes; length-prefix seria overkill pro volume, delimitador de linha é depurável |
| CLI | [commander](https://github.com/tj/commander.js) 15 | Registro modular por comando, subparsing built-in |
| Test runner | `bun test` | Auto-discovery de `*.spec.ts`, mesmo runtime da produção — zero diferença de comportamento entre teste e app |
| Formatter + linter | Biome 2 | Substitui prettier + eslint com 1 config, roda em ~50ms em todo o repo |
| Monorepo orchestration | Turborepo 2.10 | Task pipelines com cache, `dependsOn: ["^build"]` pra ordering correto |

## Estrutura do monorepo

```
stream-scrapper/
├── apps/
│   ├── daemon/                    ← processo long-running, single instance
│   │   ├── src/
│   │   │   ├── @errors/           ← classes de erro tipadas (ErrorOptions.cause)
│   │   │   ├── @shared/events/    ← EventBus in-process + contrato base
│   │   │   ├── application/       ← núcleo hexagonal
│   │   │   │   ├── models/        ← tipos de domínio puros
│   │   │   │   ├── repositories/  ← interfaces (ports)
│   │   │   │   └── use-cases/     ← unidade de intenção (1 classe = 1 caso)
│   │   │   ├── infrastructure/    ← implementações (driven adapters)
│   │   │   │   ├── database/      ← DrizzleXxxRepository, schemas
│   │   │   │   ├── ipc/           ← IpcServer + IpcRouter (driving adapter)
│   │   │   │   ├── media-storage/ ← filesystem gateway + schema meta.json
│   │   │   │   ├── monitor/       ← poll de API + emissão de eventos
│   │   │   │   ├── recorder/      ← streamlink subprocess management
│   │   │   │   └── twitch/        ← HTTP client + zod schemas do provider
│   │   │   ├── test/              ← helpers compartilhados (fakes)
│   │   │   └── main.ts            ← composition root: instância única de tudo
│   │   └── notes/                 ← decisões arquiteturais versionadas
│   └── cli/                       ← thin adapter: parseia argv, fala com daemon
│       └── src/
│           ├── client.ts          ← IpcClient (conecta, envia, aguarda resposta)
│           ├── commands/          ← 1 arquivo por comando (ping, add-channel…)
│           └── index.ts           ← commander wiring
├── packages/
│   └── ipc/                       ← protocolo compartilhado — fonte única
│       └── src/
│           ├── protocol.ts        ← IpcRequest/IpcResponse (zod discriminated union)
│           ├── framing.ts         ← NDJSON encode + LineBuffer
│           └── socket-path.ts     ← resolução XDG_RUNTIME_DIR + override env
├── scripts/
│   └── smoke-e2e.ts               ← E2E real: sobe daemon isolado, roda CLI, mata tudo
├── biome.json                     ← formatter/linter compartilhado
├── turbo.json                     ← pipeline de tasks
└── package.json                   ← workspaces + scripts raiz
```

**Convenção de imports**: `@/` mapeia pra `apps/daemon/src/`. Cross-package
usa `@repo/ipc` (workspace protocol).

## Arquitetura

### Hexagonal com dois driving adapters

```
  Driving adapters              Núcleo (application)          Driven adapters
  ────────────────              ────────────────────          ─────────────────

  CLI ──▶ IpcServer ──▶┐                                 ┌──▶ ChannelRepository
                       │      AddChannelUseCase          │    (Drizzle)
                       │      EnableAutoRecordingUseCase │
  Monitor ──▶ Bus ──▶  │─────▶StartRecordingUseCase ─────│──▶ MediaStorage
    (poll de API)      │      StopRecordingUseCase       │    (filesystem)
                       │      FinalizeRecordingUseCase   │
  Recorder ──▶ Bus ──▶─┘                                 └──▶ StreamRecorder
    (proc.exited)                                             (streamlink)
                                                              TwitchClient (GQL)
```

- **Núcleo (application/)** não conhece nenhum adapter. Depende só de
  interfaces (`ChannelRepository`, `TwitchRecorder`, `MediaStorage`,
  `StreamMetaStorage`, `TwitchClient`) e do EventBus. Testado
  in-memory com fakes.
- **Driving adapters** (quem *aciona* o núcleo) são dois: **IPC**
  (comandos vindos do CLI via socket) e **EventBus** (reações a eventos
  do Monitor e do próprio Recorder). Ambos traduzem input externo →
  primitivos → `useCase.execute()`.
- **Driven adapters** (quem o núcleo *aciona*) implementam as interfaces.
  Trocar SQLite por Postgres = novo `PostgresChannelRepository`, zero
  toque em use case.
- **Composition root** ([apps/daemon/src/main.ts](apps/daemon/src/main.ts))
  é o único lugar que sabe da existência de todos: instancia infra,
  monta use cases, faz `bus.subscribe(...)` e passa handler pro IpcServer.
  DI manual — sem container mágico.

### Simetria comandos ↔ eventos

Um use case não sabe quem o chamou:

```ts
// Vindo do CLI (IpcServer → IpcRouter → dispatch tipado)
{ cmd: 'add-channel', username: 'x' } ──▶ addChannel.execute({ channelName: 'x' })

// Vindo do Monitor (bus.publish → subscriber → thin adapter)
new ChannelLiveEvent({...})           ──▶ startRecording.execute({...})
```

Isso mantém o núcleo neutro: adicionar um comando `force-record` que
reusa `StartRecordingUseCase` = uma nova entrada no schema IPC + um handler
no router. Nada muda no use case.

## Padrões notáveis

### EventBus in-process com contrato explícito

O bus roteia por identidade da classe do evento (`event.constructor` como
chave no `Map`), awaita subscribers sequencialmente, isola erros por
handler (um handler bugado não derruba os outros nem o `publish()`).

O **publisher decide** se awaita ou não — decisão arquitetural com
consequências reais em latência e correção de shutdown. Documentado em
[notes/events-publisher-await-semantics.md](apps/daemon/notes/events-publisher-await-semantics.md).

A escolha "local → Emitter genérico → EventBus central" tem 3 estágios
com trade-offs distintos, discutidos em
[notes/events-evolution.md](apps/daemon/notes/events-evolution.md).

### Use case como unidade de intenção + `Result<L, R>`

Cada verbo do sistema é uma classe com `execute(params)`. Deps injetadas
via constructor. Retorna `Result<ErrorClass, SuccessData>` — não
`throw`, não callback. Caller (subscriber ou IPC handler) inspeciona
`isSuccess()`/`isFailure()` e decide o que fazer.

Exemplo:

```ts
export class StartRecordingUseCase {
    constructor(private readonly props: UseCaseProps) {}

    async execute(params: UseCaseParams): Promise<Result<StreamRecordingFailedError, void>> {
        try {
            await this.props.streamRepository.createStream({...})
            const { fullPath } = this.props.storage.createStreamPath({...})
            this.props.streamMetaStorage.writeStreamMeta({...})
            await this.props.recorder.recordTwitchStream({...})
            return success(undefined)
        } catch (error) {
            return failure(new StreamRecordingFailedError(channelName, { cause: error }))
        }
    }
}
```

Erros propagam via `Error.cause` (padrão ES2022) — subscriber pode
inspecionar a causa raiz sem parsing de mensagem.

### IPC tipado com protocolo compartilhado

O package [`@repo/ipc`](packages/ipc/) é a **fonte única de verdade** do
contrato — daemon e CLI ambos importam daí:

```ts
// packages/ipc/src/protocol.ts
export const IpcRequest = z.discriminatedUnion('cmd', [
    PingRequest,
    AddChannelRequest,
    EnableAutoRecordingRequest,
])
export type IpcRequest = z.infer<typeof IpcRequest>
```

No lado do daemon, `IpcRouter` faz dispatch tipado via `Record<cmd, Handler<cmd>>`
com mapped types — se um comando novo entra no schema, TypeScript quebra
até você registrar o handler. Impossível esquecer.

O framing usa **NDJSON** (linha-por-mensagem) em vez de length-prefix —
depurável com `nc -U` ou `socat`, custo baixo pro volume esperado. Ver
[packages/ipc/src/framing.ts](packages/ipc/src/framing.ts).

Socket path segue XDG: `$XDG_RUNTIME_DIR/stream-scrapper.sock` com
fallback pra `tmpdir()`. Override via `STREAM_SCRAPPER_SOCKET` env pra
isolamento em testes E2E.

### Durabilidade em dupla fonte: DB + sidecar JSON

Cada gravação escreve um `meta.json` ao lado do `stream.ts` no filesystem
— **auto-suficiente**, versionado com `meta_schema_version`, atualizado
atomicamente via `writeFileSync(tmp) + renameSync(tmp, dest)`.

```
data/<channel>/<data>/<título>(<streamId>)/
├── stream.ts        ← MPEG-TS bruto do streamlink
└── meta.json        ← metadados durables (schema versionado)
```

Motivação: o DB pode ser reconstruído a partir dos sidecars (rebuild via
scan do filesystem). Se o DB corromper ou for perdido, os vídeos
continuam auto-descritos. Se o sidecar corromper, o DB é fonte
canônica. Redundância deliberada — o custo é uma escrita extra por
gravação, o ganho é resiliência contra 2 modos de falha diferentes.

Update do sidecar acontece **quando o streamlink morre** — o recorder
publica `RecordingFinishedEvent` ou `RecordingFailedEvent` no bus, o
`FinalizeRecordingUseCase` recebe e reescreve o `meta.json` com
`endedAt`, `bytes`, `status`. Ver
[notes/recorder-implementation.md](apps/daemon/notes/recorder-implementation.md).

### Composition root explícito

Não uso DI container. `main.ts` é ~130 linhas que instanciam tudo em
ordem topológica de dependências, no formato "banda larga acima, ponta
fina abaixo":

```ts
// Infra base
const db = createDrizzle(createDatabase(config.databasePath))
const bus = new EventBus()

// Persistência
const storage = new MediaStorage({ rootPath: config.dataDir })
const channelRepository = new DrizzleChannelRepository({ drizzle: db })

// Use cases (recebem deps por props)
const startRecording = new StartRecordingUseCase({ streamRepository, storage, recorder, streamMetaStorage })
// ... etc

// Wiring: comandos e reações
bus.subscribe(ChannelLiveEvent, async event => {
    const result = await startRecording.execute({...})
    if (result.isFailure()) console.error('[start-recording]', result.value)
})
```

Trade-off consciente: perde-se auto-wiring de containers como `tsyringe`,
mas ganha-se transparência total — pra saber quem instancia o quê, uma
leitura sequencial do arquivo responde.

### 3 tiers de teste com custos crescentes

| Tier | Extensão | Runtime | Escopo | Roda por padrão? |
|---|---|---|---|---|
| Unit | `*.spec.ts` | `bun test` (auto-discovery) | Use case + fake driven adapters | ✅ |
| Integration | `*.integration-spec.ts` | `find ... -exec bun test` | IpcServer real + DB in-memory + fake TwitchClient | ✅ via `test:integration` |
| E2E smoke | `scripts/smoke-e2e.ts` | `bun scripts/smoke-e2e.ts` | Daemon como subprocess + CLI real + Twitch real | ❌ manual, pré-release |

Unit tests usam **fakes locais** (`FakeTwitchClient`, `FakeRecorder`) em
`src/test/` — implementam a mesma interface das versões reais, sem
mocking framework. Um erro no fake é um erro de TypeScript.

## Decisões técnicas + trade-offs

- **Bun em vez de Node**: elimina toolchain (ts-node, esbuild, jest, dotenv)
  — o runtime traz tudo. Custo: menor maturidade de ecossistema pra libs
  não-standard. Mitigação: dependências são poucas e mainstream (zod,
  commander, drizzle).
- **SQLite em vez de Postgres**: single-process, single-node, sem
  servidor. Custo: sem escala horizontal — mas é um daemon long-running,
  não uma web app. Bun tem `bun:sqlite` nativo.
- **Drizzle em vez de Prisma/TypeORM**: SQL-first, tipos gerados,
  migrations versionadas. Sem runtime engine binary (Prisma) nem
  decorators (TypeORM). Migrations vivem em `.drizzle/` versionadas no
  git.
- **Unix socket em vez de HTTP**: filho ~50µs por request, autenticação
  via permissão do FS (dono do socket = quem pode falar), sem porta
  ocupada. Custo: cross-machine impossível — mas daemon + CLI rodam no
  mesmo host por design.
- **streamlink como subprocess em vez de biblioteca**: streamlink é
  Python, biblioteca não expõe estabilidade. Subprocess isola: se
  streamlink crashar, o daemon continua vivo, `proc.exited` captura o
  código e a gente lida. `SIGTERM` deixa o `.ts` fechar limpo; `SIGKILL`
  fallback em 10s protege contra travados.
- **`z.coerce.date()` em vez de reviver manual**: JSON.parse devolve
  string, zod hidrata pra `Date` — evita `new Date(str)` espalhado.

## Como rodar

Pré-requisitos: Bun 1.3+, streamlink instalado no PATH (ou `STREAMLINK_BIN_PATH`
apontando pro binário).

```sh
# Instalar deps
bun install

# Rodar o daemon (bloqueante — Ctrl+C pra parar)
bun apps/daemon/src/main.ts

# Em outro terminal: usar o CLI
bun scrapper ping                          # verifica que o daemon está vivo
bun scrapper add-channel <username>        # cadastra canal pra monitorar
bun scrapper enable-auto-recording <user>  # habilita gravação automática
```

Testes:

```sh
bun test                    # unit — rápido, isolado
bun run test:integration    # integration — DB in-memory, IPC real, fake Twitch
bun run test:e2e            # smoke E2E — sobe daemon isolado, toca Twitch de verdade
```

Migrations do DB:

```sh
cd apps/daemon
bun run db:generate    # gera SQL da diferença entre schema.ts e último snapshot
bun run db:migrate     # aplica migrations pendentes
bun run db:studio      # UI web pra explorar o DB
```

## Roadmap

Estado atual: pipeline completo funciona ponta-a-ponta (detectar live →
gravar → fechar meta.json com sucesso ou falha). Próximos passos:

- **Rewrap `.ts` → `.mp4`**: job assíncrono via ffmpeg reagindo a
  `RecordingFinishedEvent`. O `.ts` é o formato bruto que o streamlink
  entrega; MP4 é o que a maioria dos players consome bem.
- **DB update na finalização**: hoje só o `meta.json` fecha em `finished`,
  o `stream.durationSeconds` no DB continua nulo. Adicionar método
  `updateStreamOnFinish` no `StreamRepository`.
- **Webhooks de notificação**: consumidor adicional dos eventos
  `RecordingFinished/Failed` que dispara Discord/Slack. O EventBus foi
  desenhado exatamente pra isso — 1 linha de `bus.subscribe` no
  composition root, zero toque em produtor.
- **Retenção de gravações**: policy de expiração por canal (manter só
  últimas N ou últimos M dias). Job periódico via cron interno ou
  systemd timer externo.

## Referências profundas

Decisões arquiteturais com contexto histórico completo (por que foi
feito assim, alternativas consideradas, trade-offs aceitos) vivem em
[`apps/daemon/notes/`](apps/daemon/notes/):

- **[events-evolution.md](apps/daemon/notes/events-evolution.md)** —
  os 3 estágios da comunicação pubsub (local → Emitter → EventBus) e
  quando promover
- **[events-publisher-await-semantics.md](apps/daemon/notes/events-publisher-await-semantics.md)** —
  fire-and-forget vs await no `bus.publish()`, e por que a decisão é do
  publisher (não do bus)
- **[recorder-implementation.md](apps/daemon/notes/recorder-implementation.md)** —
  child process management, SIGTERM+SIGKILL fallback, ring buffer de
  stderr, ordem de eventos no shutdown
- **[recording-twitch-streams.md](apps/daemon/notes/recording-twitch-streams.md)** —
  por que streamlink em vez de youtube-dl/yt-dlp, escolha do formato `.ts`,
  auth do provider
- **[speculation-early-live-detection-to-recording-flow.md](apps/daemon/notes/speculation-early-live-detection-to-recording-flow.md)** —
  raciocínio prévio (antes de implementar) sobre o fluxo Monitor → Engine
  → Recorder, incluindo caminhos descartados
- **[speculation-early-recorder-invariants-vs-reactions.md](apps/daemon/notes/speculation-early-recorder-invariants-vs-reactions.md)** —
  distinção entre invariantes síncronas (persistir stream + spawnar
  recorder) e reações assíncronas (rewrap, notificações) — motivo do
  `try/catch` no `handleExit`
