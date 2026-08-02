# EventBus: publisher decide `await` ou fire-and-forget

## Contexto

O [`EventBus`](../src/@shared/events/event-bus.ts) do daemon expõe `publish`
como método `async`. A superfície é minúscula, mas esconde uma decisão
arquitetural que costuma passar batido: **quem publica escolhe se
awaita ou não o pipeline de subscribers**. O bus não escolhe por você — e
essa escolha tem consequências reais em latência, correção de shutdown, e
acoplamento entre módulos.

Este documento existe porque durante a implementação do
`FinalizeRecordingUseCase` (fechar `meta.json` quando streamlink morre),
essa exata escolha causou um bug latente no shutdown do daemon e forçou
uma virada de "fire-and-forget" pra "await" no `handleExit` do recorder.
A confusão que aparece na hora ("mas o bus não é fire-and-forget?") merece
ficar registrada.

## O bus **não** é fire-and-forget internamente

Olhando o corpo do `publish`:

```ts
async publish<E extends Event>(event: E): Promise<void> {
    const list = this.handlers.get(event.constructor as Ctor) ?? []
    for (const handler of list) {
        try {
            await handler(event)   // sequencial, awaitando cada um
        } catch (err) {
            console.error('[bus] handler failed:', err)
        }
    }
}
```

Duas propriedades importantes garantidas pelo bus:

1. **Handlers rodam sequencialmente**, em ordem de subscribe. Não é
   `Promise.all` — é `for + await`. Handler N+1 só começa depois que N
   resolveu.
2. **Cada handler é isolado por try/catch**. Um handler que joga não
   derruba os outros nem faz o `publish` rejeitar. `publish` NUNCA
   throw — só retorna quando todos os handlers terminaram (ou joga, e o
   bus loga).

O que o bus **não** faz:
- Não roda handlers em paralelo (mesmo os independentes)
- Não swallowa timeout (handler lento trava a fila)
- Não força o publisher a esperar — o publisher recebe uma `Promise<void>`
  e faz o que quiser com ela

## As 3 camadas de assincronia

| Camada | Comportamento | Configurável? |
|---|---|---|
| **Bus interno** (`publish`) | Sequential-await de todos os subscribers | ❌ hardcoded |
| **Publisher** (`bus.publish(...)`) | `await` ou `void` — decide caso a caso | ✅ por call site |
| **Subscriber** (função registrada) | Sync ou async (`void \| Promise<void>`) | ✅ por handler |

Só a camada do meio (**publisher**) é onde "fire-and-forget vs await"
existe. E a decisão é distribuída — cada `bus.publish(...)` no código
pode escolher diferente.

## Fire-and-forget: `void bus.publish(...)`

```ts
void bus.publish(new SomeEvent(...))
```

Publisher dispara o evento, descarta a `Promise`, segue em frente
imediatamente. Subscribers processam em background, mas o publisher não
sabe (nem se importa) quando terminam.

**Quando faz sentido:**

- Publisher está em hot path que não pode bloquear (loop de polling
  agressivo, event loop principal com timing crítico)
- Consequências de falha do subscriber são cosméticas (métrica perdida,
  notificação atrasada)
- Publisher não tem próximo passo dependente do outcome dos subscribers

**Nota**: nenhum publisher no daemon usa esse modo hoje. Todos os
`bus.publish` são awaitados (`Monitor` awaita porque quer serializar
`ChannelLive/Offline` dentro do mesmo tick; `Recorder` awaita por causa
do shutdown, como descrito abaixo). O modo fire-and-forget está aqui como
opção **suportada pelo bus**, disponível caso um publisher futuro precise
(webhook não-crítico, métrica de alto volume) — não como pattern
recomendado por padrão.

**Cuidado**: erros dentro dos subscribers só vão pro `console.error` do
bus. Se você quiser fail-fast, `await` + inspecionar o Result (mas o bus
não expõe Results — ver seção "Limitações" abaixo).

## Await: `await bus.publish(...)`

```ts
await bus.publish(new SomeEvent(...))
// próximo passo só roda depois que TODOS os subscribers processaram
```

Publisher espera todos os subscribers terminarem antes de continuar. Se
algum for lento, o publisher espera. Se algum joga, o bus loga e o
próximo continua — mas o `publish` só resolve no fim da fila.

**Quando faz sentido:**

- Publisher precisa de garantia de durabilidade (ex: shutdown que precisa
  garantir que `meta.json` fechou antes do processo sair)
- Próximo passo do publisher lê estado que subscribers modificaram
- Ordem observável importa (ex: log A antes de log B)

## Case study: recorder + shutdown

O `handleExit` do [`StreamRecorder`](../src/infrastructure/recorder/recorder.ts)
começou fire-and-forget:

```ts
// Versão original — publisher descarta a Promise
void this.props.bus.publish(new RecordingFinishedEvent(...))
```

Fazia sentido: `handleExit` é chamado de dentro de
`proc.exited.then(...)`, callback puramente reativo. Sem "próximo passo"
do publisher, não tinha razão pra bloquear.

**O bug latente**: no shutdown do daemon (Ctrl+C), a sequência era:

1. `shutdown()` → `recorder.stopAll()`
2. `stopAll` envia SIGTERM pra cada streamlink e **retorna imediatamente**
3. `ipc.close()`, `main()` resolve, Bun **sai**
4. streamlink filhos ainda flushando `.ts` — `proc.exited` nunca resolve
   dentro do nosso processo
5. `handleExit` nunca roda → `bus.publish` nunca dispara → `finalize`
   nunca escreve → `meta.json` **preso em `"status": "recording"`**

O fix teve 3 passos, todos concentrados no recorder:

1. `handleExit` virou `async` e passou a `await this.props.bus.publish(...)`
   — agora o Promise retornado por `handleExit` só resolve quando o
   `finalize` terminou
2. Capturamos o Promise retornado por `proc.exited.then(handleExit)` como
   `exitHandled` num campo do `ActiveRecording`
3. `stopAll` faz snapshot desses `exitHandled` **antes** de sinalizar,
   envia SIGTERMs, e depois `await Promise.allSettled(pending)` — garante
   que Bun não sai antes de todos os `meta.json` fecharem

**O que ficou não-bloqueante:** o método `stopStream` do recorder (não
o `publish`), quando chamado reactive via `ChannelOfflineEvent`. Ele só
envia SIGTERM e retorna imediatamente — não awaita `proc.exited`. O
handler do `ChannelOfflineEvent` executa `stopRecording.execute` e
resolve rápido; a finalização acontece depois, em background, quando o
streamlink de fato morrer e o `handleExit` disparar. Se essa cadeia
tivesse virado bloqueante, o bus (que awaita subscribers sequencialmente)
serializaria offlines de múltiplos canais em cima da latência de fecho
do streamlink.

Ou seja: o **bus** e o **publish** continuam awaited (Monitor no publish,
Recorder no handleExit). O que **não** é bloqueante é a operação
`stopStream` — decisão fora do bus, no design da própria classe recorder.

## Consequências e trade-offs

### `await publish` acopla latência

No momento em que o publisher awaita, ele fica escravo da latência do
subscriber mais lento. Um subscriber novo (webhook Discord, métrica
Prometheus) que pendura 30s vai propagar esse atraso pro `stopAll` →
shutdown → user esperando o daemon fechar.

**Mitigações possíveis (nenhuma implementada hoje):**

- Timeout por handler dentro do `publish`:
  `await Promise.race([handler(event), sleep(5000)])`
- Classificar subscribers: "invariante" (await) vs "notificação" (fire),
  com métodos separados no bus (`publishSync` / `publishAsync`)
- Tag por handler priority — invariantes primeiro, notificações depois
  com `Promise.allSettled` sem await

Prematuro agora: só 1 subscriber crítico por evento hoje (`finalize`),
todo o resto é hipotético.

### Isolamento de erro é preservado nos dois modos

O try/catch por handler está dentro do bus, não depende de como o
publisher usa o Promise. `void publish` e `await publish` têm mesma
garantia: 1 handler ruim não derruba os outros.

O que muda é **quando o publisher fica sabendo do erro**:
- Fire-and-forget: nunca (só o console.error do bus registra)
- Await: também nunca (o bus **engole** — `publish` resolve mesmo com
  handlers que jogaram)

### Ordem entre publicações independentes não é garantida

`await bus.publish(A)` seguido de `await bus.publish(B)` garante que
todos handlers de A rodam antes de qualquer handler de B. Mas se dois
publishers diferentes chamam `bus.publish` em paralelo, a ordem entre
eles é indefinida (depende do event loop). Não é limitação do bus — é
consequência de JS single-threaded com async.

## Limitações que valem estar cientes

- **`publish` não retorna outcome dos handlers.** Nem success/failure,
  nem quais rodaram. Se você precisa saber "o handler X escreveu o
  meta.json?", não dá pra descobrir pelo bus — precisa de outro canal
  (Result no return do use case, log, etc).
- **Handlers são engolidos ao rejeitar.** Se um subscriber joga, `publish`
  resolve normal. Publisher que quer fail-fast num handler específico não
  consegue via bus — teria que chamar o handler direto.
- **Sem cancelamento.** Publicou, publicou. Não dá pra "cancelar" um
  publish em andamento. `AbortSignal` não é propagado.

## Regras práticas

| Situação do publisher | Modo |
|---|---|
| Loop reativo/polling que não pode bloquear | `void publish` |
| Métrica, notificação, log — subscriber é decorativo | `void publish` |
| Próximo passo depende de subscriber terminar | `await publish` |
| Shutdown / cleanup precisa garantir durabilidade | `await publish` |
| Test que precisa observar side effect do subscriber | `await publish` |

## Referências no código

- **Bus**: [apps/daemon/src/@shared/events/event-bus.ts](../src/@shared/events/event-bus.ts) — `EventBus.publish` sequencial-await + isolamento por handler
- **Publisher await (shutdown-crítico)**: [apps/daemon/src/infrastructure/recorder/recorder.ts](../src/infrastructure/recorder/recorder.ts) — `handleExit` awaita `bus.publish`; `stopAll` captura `exitHandled` promise no `ActiveRecording` e awaita `Promise.allSettled` no shutdown
- **Publisher await (serialização por tick)**: [apps/daemon/src/infrastructure/monitor/monitor.ts:96-106](../src/infrastructure/monitor/monitor.ts#L96-L106) — Monitor awaita `bus.publish` de `ChannelLiveEvent`/`ChannelOfflineEvent` dentro do loop de canais, garantindo ordem previsível de transições no mesmo tick
- **Não-bloqueante fora do bus**: `StreamRecorder.stopStream` retorna após enviar SIGTERM sem awaitar `proc.exited` — evita serializar offlines reactive em cima da latência do streamlink morrer
- **Contexto complementar**: [events-evolution.md](./events-evolution.md) — quando promover local → Emitter → Bus (essa nota assume que Bus já foi escolhido)
