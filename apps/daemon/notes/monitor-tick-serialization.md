# Monitor: serialização por tick (por que `await bus.publish` no loop)

## Contexto

O [`ChannelMonitor`](../src/infrastructure/monitor/monitor.ts) é um dos dois
driving adapters do daemon (o outro é o IPC). A cada intervalo ele faz uma
passada — um **tick** — perguntando pra Twitch quem está ao vivo, comparando
com o estado guardado e publicando eventos só nas transições.

Dentro dessa passada, os `bus.publish(...)` são **awaitados**, dentro de um
`for`. Esta nota explica por que — o motivo é diferente do await do Recorder
(que é durabilidade no shutdown, ver
[events-publisher-await-semantics.md](./events-publisher-await-semantics.md)).
Aqui o await é sobre **controle e ordem dentro do tick**, não sobre o processo
encerrar.

## O que é um "tick"

`startMonitoring` roda `checkOnLiveChannels()` e, **depois que ele termina**,
reagenda a si mesmo:

```ts
async startMonitoring() {
    try {
        await this.checkOnLiveChannels()
    } catch (error) {
        console.error('[monitor] checkOnLiveChannels failed:', error)
    }
    // setTimeout que se reagenda: zero overlap se checkOnLiveChannels() atrasar.
    this.timer = setTimeout(() => this.startMonitoring(), this.props.intervalMs)
}
```

É `setTimeout` que se reagenda, **não** `setInterval`. A diferença é
intencional: o próximo tick só é agendado quando o atual termina por
completo. Se um tick demora mais que `intervalMs`, não há dois ticks
rodando sobrepostos — o próximo espera. Guarde isso: o await dos publishes
é o que faz "terminar por completo" incluir as reações, não só o polling.

## O loop dentro do tick

```ts
for (const channel of channels) {
    const wasLive = channel.isLive
    const liveInfo = liveNow.get(channel.username.toLowerCase())
    const isLive = liveInfo !== undefined
    if (wasLive === isLive) continue   // age só nas transições

    await this.props.channelRepository.updateChannel({ id: channel.id, isLive })
    if (liveInfo !== undefined) {
        await this.props.bus.publish(new ChannelLiveEvent({ ... }))
    } else {
        await this.props.bus.publish(new ChannelOfflineEvent(channel.username))
    }
}
```

Como o `await` está **dentro** do `for`, o loop é sequencial: a transição do
canal A é processada inteira — incluindo todos os subscribers do evento
(hoje o `StartRecordingUseCase`, que persiste a stream, cria a pasta, escreve
o `meta.json` inicial e **spawna o streamlink**) — antes de o loop sequer
olhar pro canal B.

## O que aconteceria sem o `await`

Importante ser preciso: **não seria corrupção de dados.** Canais diferentes
tocam estado disjunto — cada um tem seu `streamId`, sua pasta, seu processo
streamlink. A e B "ao mesmo tempo" não se atropelam.

O que mudaria com `void bus.publish(...)`: o loop dispararia a reação do A e
seguiria **na hora** pro B sem esperar. As cadeias de A, B, C… ficariam
entrelaçadas no event loop, rodando concorrentemente. Num tick onde 30 canais
ficam live de uma vez:

| | Com `await` (hoje) | Com `void` (fire-and-forget) |
|---|---|---|
| Spawns de streamlink | 1 de cada vez, em sequência | 30 largando de uma vez, disputando CPU/rede/fds |
| Ordem de conclusão | previsível (ordem do loop) | loteria do event loop |
| Fim do `checkOnLiveChannels` | só quando todas as reações terminam | retorna antes das reações terminarem |

Então "imprevisível" aqui não é bug de dado — é **concorrência descontrolada**:
pico de spawns simultâneos e ordem não-determinística de efeitos.

## Os 3 ganhos do await aqui

1. **Throttle do burst.** Reações caras (spawnar processo) acontecem uma de
   cada vez, não num pico simultâneo. Um tick com muitos canais virando live
   ao mesmo tempo não estoura recursos de uma vez.
2. **Isolamento entre ticks.** Como `startMonitoring` só reagenda depois de
   `checkOnLiveChannels()` resolver, e os publishes são awaitados,
   `checkOnLiveChannels` só "termina" quando as reações terminaram. Sem o
   await ele retornaria cedo e o próximo tick poderia começar com as
   gravações do tick anterior ainda se montando — o "zero overlap" do
   comentário do `setTimeout` só vale de verdade por causa disso.
3. **Ordem determinística de efeitos e erros.** Logs e side effects saem em
   ordem de canal; se o A falhar, você lida antes de começar o B.

## Contraste com o await do Recorder

Os dois awaitam `bus.publish`, mas por motivos diferentes — vale não
confundir:

| | Monitor | Recorder (`handleExit`) |
|---|---|---|
| Motivo do await | serialização/controle dentro do tick | durabilidade no shutdown |
| Depende do processo encerrar? | não — daemon segue vivo | sim — é o único momento crítico |
| O que quebraria sem await | pico de spawns + ordem não-determinística | `meta.json` preso em `"recording"` |

O Recorder awaita pra segurar o processo vivo até o `finalize` fechar o
sidecar. O Monitor awaita só pra processar uma transição por vez, ordenada e
sem estourar recurso. Nenhum dos dois usa fire-and-forget hoje — ver a tabela
"Regras práticas" em
[events-publisher-await-semantics.md](./events-publisher-await-semantics.md).

## Referências no código

- **Loop com await**: [apps/daemon/src/infrastructure/monitor/monitor.ts:85-107](../src/infrastructure/monitor/monitor.ts#L85-L107) — `for` sobre canais, `await bus.publish` por transição
- **Reagendamento sem overlap**: [apps/daemon/src/infrastructure/monitor/monitor.ts:42-50](../src/infrastructure/monitor/monitor.ts#L42-L50) — `setTimeout` que se reagenda após `await checkOnLiveChannels()`
- **Subscriber que roda na transição live**: [apps/daemon/src/application/use-cases/start-recording.ts](../src/application/use-cases/start-recording.ts) — persiste stream, cria pasta, escreve meta, spawna streamlink
- **Semântica geral de await no bus**: [events-publisher-await-semantics.md](./events-publisher-await-semantics.md) — publisher decide await vs fire-and-forget; case study do Recorder
