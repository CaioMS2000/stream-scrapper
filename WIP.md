# WIP: Refatorar Engine → use cases + conectar IPC pra valer

Grande missão em curso. Motivação: Engine hoje mistura dois papéis distintos
(comandos vindos do IPC e reações vindas do bus), e a camada IPC está
desconectada da aplicação — o único comando existente (`ping`) nem toca a
Engine. Vamos adicionar vários comandos novos, então é a hora de estabelecer o
pattern certo antes que a Engine cresça pra 15 métodos.

Referência conceitual: hexagonal / ports & adapters. Discussão longa em
`Claude-Aplicação TypeScript de longa execução com interface CLI.md` (agente
externo) + refinamento nesta conversa que ajusta o modelo pra nossa realidade.

## Modelo mental — hexagonal com bus

```
Driving (quem aciona)        Núcleo (use cases)         Driven (o que é acionado)
────────────────────         ──────────────────         ─────────────────────────
CLI → IpcServer → Router  →                          →  ChannelRepository
                            AddChannelUseCase           StreamRepository
Monitor → EventBus        →  StartRecordingUseCase   →  MediaStorage
                            StopRecordingUseCase        StreamRecorder (streamlink)
                            ...                         TwitchClient (gateway)
```

**Correção importante ao diagrama do agente externo (arquivo .md acima)**: o
Monitor é **outro driving adapter**, não parte do núcleo. Ele detecta mudança
externa (canal ao vivo na Twitch) e alimenta o núcleo via bus — análogo do CLI,
só que a "porta" é o EventBus em vez do IPC socket.

Use case não sabe quem o chamou. `StartRecordingUseCase.execute(...)` funciona
igual se veio de `ChannelLiveEvent` ou de um hipotético comando `force-record`
no CLI.

## Simetria comandos ↔ eventos

| | Comandos | Eventos |
| --- | --- | --- |
| Origem | Humano via socket | Monitor / outros producers via bus |
| Dispatch | `Record<cmd, handler>` no Router | `bus.subscribe(EventClass, handler)` no wiring |
| Handler | Thin adapter: parseia entrada + chama use case | Thin adapter: extrai payload + chama use case |
| Use case | Mesma forma nos dois lados | Mesma forma nos dois lados |
| Retorno | Serializado em `IpcResponse` | Descartado (ou dispara outro evento) |

Do lado do use case, a diferença é invisível.

## Dispatch dos comandos — pattern que escala

`IpcRequest` no `@repo/ipc` já é **discriminated union por `cmd`**. Isso
destrava dispatch tipada, sem switch crescente:

```ts
type Handler<C extends IpcRequest['cmd']> = (
  req: Extract<IpcRequest, { cmd: C }>
) => Promise<IpcResponse>

type Handlers = { [C in IpcRequest['cmd']]: Handler<C> }

const handlers: Handlers = {
  ping: async () => ({ ok: true, cmd: 'ping', uptime: process.uptime() }),
  'add-channel': async req => {
    const result = await deps.addChannel.execute({ channel: req.username })
    if (result.isFailure()) return { ok: false, error: result.value.message }
    return { ok: true, cmd: 'add-channel', channel: result.value }
  },
  // ...
}

return (req: IpcRequest) => (handlers[req.cmd] as Handler<typeof req.cmd>)(req)
```

Ganhos:
- **Exhaustiveness em compile time** — adicionar variante no union sem entrada
  em `handlers` = erro do TS
- **Type narrowing automático** — dentro de cada handler o `req` já é a
  variante certa, autocompleta os campos
- **Adicionar comando = 1 variante no schema + 1 chave no map**, zero mexida em
  router logic
- Único `as` sobra no return (TS não correlaciona `req.cmd` com a chave
  automaticamente) — pontual, isolado

## Wiring dos eventos — escala por volume de subscribes

Eventos não precisam de Record — os próprios `bus.subscribe(...)` já são a
"tabela declarativa". A organização segue por volume:

- **2-3 subscribes** (estado atual): inline no `main.ts`, sem cerimônia
- **5-6 subscribes**: extrair pra `wire-events.ts` que recebe `{ bus, useCases... }`
- **10+ ou domínios distintos**: split (`wire-recording-events.ts`, `wire-notification-events.ts`)

Super-poder do bus (que Record de comandos não tem): **fan-out** — mesmo
evento pra múltiplos consumidores. Adicionar Discord notify amanhã:

```ts
bus.subscribe(ChannelLiveEvent, e => startRecording.execute(e))
bus.subscribe(ChannelLiveEvent, e => discordNotify.execute(e))  // futuro
bus.subscribe(ChannelLiveEvent, e => metrics.recordLiveDetected(e))  // futuro
```

Zero mexida em Monitor ou em StartRecordingUseCase. É a razão de existir o bus
(ver [events-evolution.md](apps/daemon/notes/events-evolution.md)).

## Ordem de execução recomendada

1. **Extrair use cases dos 2 comandos existentes** — `AddChannelUseCase` e
   `EnableAutoRecordingUseCase` em `src/use-cases/`. Cada um: classe fininha
   com `execute(input)`, dependências via DI no construtor. Corpo movido da
   Engine.
2. **Refactor do router pro shape com Record** — `createRouter(deps)` passa a
   receber os use cases em vez de `engine`. Adicionar entries `'add-channel'` e
   `'enable-auto-recording'` no `handlers`. Adicionar as variantes correspondentes
   no `IpcRequest` do `@repo/ipc`. `ping` continua trivial (não usa use case).
3. **Adicionar comandos novos já no pattern novo** — cada um: 1 use case + 1
   variante no schema + 1 chave no map. Zero refactor pra próximos.
4. **Event handlers ficam onde estão até o gatilho disparar** — os 2 atuais
   (`onStreamStarted`, `onStreamEnded`) ainda são poucos e cabem em Engine.
   Quando aparecer o 3º (provavelmente `onRecordingFinished` pro rewrap MP4),
   virar todos em use cases também: `StartRecordingUseCase`, `StopRecordingUseCase`,
   `TriggerRewrapUseCase`. Subscribes em `main.ts` chamam os use cases. Engine
   deixa de existir como classe, sobrevive só como conceito ("camada de aplicação").

## Regras heurísticas de quando escalar

- **Quando splittar comandos**: já — próximos comandos entram nesse molde
- **Quando splittar event handlers**: quando aparecer o 3º reaction handler
- **Quando extrair wiring de eventos do main**: quando as linhas de subscribe
  passarem de ~5-6

## Prerequisito: validar o Recorder real end-to-end

Antes de abrir esse refactor, terminar o loop atual: `bun run src/main.ts` num
terminal, adicionar canal via IPC no outro, aguardar ~30s, e ver o
`data/<canal>/<data>/<title>(<streamId>)/stream.ts` crescer. Ctrl+C deve
encerrar limpo com log `parada solicitada`. Confirmado esse caminho feliz, o
refactor pode começar.

Quando esse loop funcionar bem, os próximos incrementos que ficaram como TODO
independentes do refactor são: eventos `RecordingFinished/Failed` no bus e job
de re-mux MP4 (ffmpeg) — ambos justificados como fases separadas em
[recorder-implementation.md](apps/daemon/notes/recorder-implementation.md).
