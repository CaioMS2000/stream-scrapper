# [ESPECULAÇÃO EARLY-GAME] Fluxo: detecção de live → gravação

> **AVISO**: Este documento é especulativo. O Recorder ainda não existe no
> código no momento em que foi escrito, e a `Engine` ainda não tem os métodos
> `onStreamStarted` / `onStreamEnded` mencionados aqui. Registra o desenho
> combinado pra não perder o raciocínio. Quando as peças forem construídas,
> revisitar este documento e ajustar contra a realidade concreta.

## Contexto

Quando o Monitor detectar que um canal entrou ao vivo, o daemon precisa:

1. **Persistir metadados da stream** (streamId, título, categoria, quando começou)
   pra que o sistema tenha rastro do que rolou.
2. **Iniciar a gravação** via Recorder.

A questão era: **quem faz cada passo?** Uma leitura ingênua colocaria o Monitor
fazendo os três (detectar + persistir + disparar Recorder), o que reverteria
todo o desacoplamento construído (Emitter injetado, Monitor puro emissor,
Engine como orquestrador).

Esta nota registra a divisão que preserva o desacoplamento sem virar
over-engineering.

## O fluxo

```
1. Monitor.checkOnLiveChannels()
   ├→ Detecta transição de canal offline → live
   └→ Emite ChannelLiveEvent (com metadados completos do stream)

2. Composition root (main.ts) — wire feito uma vez:
   monitor.on(async event => {
     if (event.type === 'live')    await engine.onStreamStarted(event)
     else if (event.type === 'offline') await engine.onStreamEnded(event)
   })

3. Engine.onStreamStarted(event) — chamado pelo listener:
   ├→ streamRepository.create({ streamId, channelName, startedAt, title, category })
   │  (INVARIANTE — chamada síncrona direta, não é event handler)
   └→ recorder.start(streamRow)
      (INVARIANTE — chamada síncrona direta, não é event handler)

4. Recorder.start(streamRow) — assume o processo longo:
   ├→ recordingRepository.create({ streamId, status: 'starting', ... })
   ├→ Spawna streamlink como child process supervisionado
   ├→ Escuta exit code / erros
   ├→ Atualiza recording row conforme progresso (status, endedAt, bytes)
   └→ Emite RecorderEvent (started/finished/failed) via Emitter próprio
      pra reações externas (rewrap, webhook, retention, etc.)
```

## Responsabilidade de cada peça

### Monitor
- Detectar transições de live/offline (via polling GQL)
- Emitir eventos com metadados completos
- **NADA além disso** — não persiste stream, não chama Recorder, não conhece
  Recorder

### Engine
- Orquestrar o "start tracking + start recording" quando Monitor emite `live`
- Persistir stream row de forma **síncrona** dentro do handler (invariante)
- Chamar Recorder.start de forma **síncrona** dentro do handler (invariante)
- Análogo pro `offline` (finalizar, ou deixar o Recorder detectar pelo próprio
  streamlink caindo — a decidir quando implementar)

### Recorder
- Executar a gravação (child process supervisionado do streamlink)
- Persistir recording row e mantê-la consistente com o processo
- Emitir eventos próprios pra reações externas (rewrap, webhook, retention)
- Detectar fim/falha e reagir

## Quem conhece quem

- **Monitor** conhece: TwitchClient, Store (canais — pra ler estado), Emitter próprio
- **Engine** conhece: Store (canais + streams), Recorder, Monitor **apenas via
  wiring** (`monitor.on(engine.onStreamStarted)` no `main.ts`; Engine não recebe
  Monitor injetado, não chama métodos dele)
- **Recorder** conhece: Store (streams, recordings), Storage/Filesystem, API
  de child process, Emitter próprio

Nenhuma peça tem referência direta a mais componentes do que precisa. Ampliar
o comportamento (adicionar webhook, métrica, log estruturado que reagem a live)
é sempre uma nova linha no `main.ts`, nunca mudança em Monitor/Engine/Recorder.

## Metadados precisam viajar no evento

Monitor já bate na Twitch e recebe todos os metadados do stream (streamId,
title, game/category, createdAt). **Não descartar essa informação** — enriquece
o evento pra Engine não precisar re-request:

```ts
// Antes (só o mínimo):
{ type: 'live'; username: string; startedAt: Date }

// Depois (todos os metadados que já temos):
{
  type: 'live'
  username: string
  startedAt: Date
  streamId: string
  title: string
  category?: string
}
```

Custo zero (Monitor já tem os campos), Engine ganha payload completo pra
persistir sem viagem extra à Twitch.

## Anti-padrão: "God Monitor"

Uma leitura tentadora seria fazer Monitor orquestrar tudo:

```ts
// ❌ NÃO fazer isso
Monitor.checkOnLiveChannels():
  ├→ detecta live
  ├→ streamRepo.create(...)     // Monitor virou persistidor
  ├→ recorder.start(...)         // Monitor virou orquestrador
  └→ termina
```

Problemas:
- Monitor **conhece Recorder** (reverte o desacoplamento inteiro)
- Monitor **escreve em `streams`** (concern que não é dele)
- Quando aparecer 4º ator (webhook, métrica, log), tudo passa a colar no
  Monitor — vira God Object
- Testar Monitor exige mock/fake de Recorder, StreamRepository, etc. — hoje
  ele testa só com fake TwitchClient e Store de canais

Se você se pegar querendo Monitor "chamando alguém direto", **pare e volte pro
fluxo com Engine no meio**. É o que preserva a arquitetura.

## Invariantes vs reações — como se encaixa aqui

A persistência da stream row e a chamada ao Recorder são **invariantes** (se
falharem, o sistema fica inconsistente — arquivo eventual sem rastro no DB, ou
gravação nunca iniciada). Por isso essas duas ações estão dentro de
`Engine.onStreamStarted` como **chamadas síncronas diretas**, NÃO como novos
event handlers.

Reações **externas** (webhook Discord "canal X ficou live", métrica
`monitor.transitions_total`, log estruturado) SIM entram como listeners
adicionais no `main.ts`:

```ts
monitor.on(async e => await engine.onStreamStarted(e))     // invariante
monitor.on(async e => await discord.notifyStreamStart(e))  // reação
monitor.on(async e => metrics.increment('monitor.live'))   // reação
```

Ordem entre listeners não é garantida — invariante ganha caminho síncrono
próprio, reações se acumulam no `on()`. Ver
[speculation-early-recorder-invariants-vs-reactions.md](./speculation-early-recorder-invariants-vs-reactions.md).

## Fluxo do `offline`

Mais aberto ainda — a decidir quando o Recorder existir. Duas opções:

- **Engine reage a `offline`** e chama `recorder.stop(username)` explicitamente
- **Recorder detecta sozinho** pelo streamlink cair (child process exit) e
  cruza com Monitor pra saber se foi fim real de live ou blip transitório
  (padrão que discutimos em `notes/recording-twitch-streams.md`)

Provavelmente **os dois** — Engine avisa o Recorder da transição observada, e
Recorder também tem seu próprio senso de "streamlink morreu, agora eu penso o
que fazer". Redundância intencional pra robustez.

## Notas relacionadas

- [events-evolution.md](./events-evolution.md) — como Emitter/EventBus evoluem
- [speculation-early-recorder-invariants-vs-reactions.md](./speculation-early-recorder-invariants-vs-reactions.md) — invariante vs reação
- [recording-twitch-streams.md](./recording-twitch-streams.md) — streamlink, tokens, TS→MP4

## Referências no código (estado atual)

- Monitor emitindo eventos: [apps/daemon/src/infrastructure/monitor/monitor.ts](../src/infrastructure/monitor/monitor.ts)
- Classes de evento: [apps/daemon/src/infrastructure/monitor/@events/channel-live.ts](../src/infrastructure/monitor/@events/channel-live.ts) —
  `ChannelLiveEvent` já carrega `username` + `title` + `startedAt`; `streamId`
  e `category` ainda são placeholders (Monitor não passa `stream.id` no evento)
- Engine (base): [apps/daemon/src/application/engine/engine.ts](../src/application/engine/engine.ts) —
  `onStreamStarted` e `onStreamEnded` implementados; disparam
  `streamRepository.createStream` + `recorder.recordTwitchStream` / `recorder.stopStream`
