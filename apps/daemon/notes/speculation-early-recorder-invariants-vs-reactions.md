# [ESPECULAÇÃO EARLY-GAME] Recorder: invariantes vs reações

> **AVISO**: Este documento é especulativo. O Recorder ainda não existe no
> código no momento em que foi escrito. Registra aqui um princípio arquitetural
> que emergiu discutindo o desenho futuro, pra não esquecer quando chegar a
> hora. Se/quando o Recorder for de fato construído, revisitar este documento
> e ajustar contra a realidade concreta — provavelmente algumas categorias vão
> mudar de lado.

## Contexto

Ao brainstormar handlers de eventos que reagiriam a um futuro `Recorder`
(webhook Discord, retention de disco, rewrap MP4, etc.), apareceu uma pergunta
sutil: **a persistência do row de `recordings` no store** — que garante que
cada arquivo `.ts` no disco tem correspondência rastreada no banco — deve ser
um handler de evento (`recorder.on('started', ...) → store.insert(...)`), ou
faz parte da lógica interna do próprio Recorder?

A resposta certa (injeção direta, interna ao Recorder) revelou um princípio
que vale generalizar pra qualquer futura decisão parecida no daemon.

## O princípio: invariante vs reação

A pergunta que separa "vai por injeção direta" de "vai por evento" é:

> **Se esse handler falhar em silêncio, o sistema fica inconsistente?**

- **Sim** → é um **invariante** do domínio. Injeção direta, síncrono, no mesmo
  caminho de execução da operação. O código não passa adiante sem completar.
- **Não** → é uma **reação** ao domínio. Handler de evento, com isolamento de
  erro (try/catch por listener). Se falhar, é chato mas não corrompe estado.

## Por que isso importa pra event handlers

Quando um evento é emitido com try/catch por listener (o padrão do `emit()` no
`ChannelMonitor` hoje), erros são **engolidos e logados**. É intencional: um
listener bugado não pode derrubar o daemon inteiro. Mas isso implica que
handlers de evento são, por design, **fire-and-hope** — a operação principal
já completou, os handlers rodam depois "por conta e risco".

Isso é OK pra reações (webhook, log, notificação — se falhar, mundo continua
girando). É **catastrófico** pra invariantes (row do store não persistido =
arquivo órfão no disco que nenhum outro código consegue rastrear, e o silêncio
do erro esconde o problema).

## Aplicado ao Recorder (especulação de desenho)

Pseudocódigo do que o Recorder faria por dentro:

```ts
async start(channel: Channel) {
  // 1. Cria o row PRIMEIRO. Se falhar, aborta antes de spawnar nada.
  //    Se der crash aqui, não existe processo streamlink solto — consistente.
  const recording = await this.store.startRecording({
    channelId: channel.id,
    status: 'starting',
  })

  try {
    const process = spawn('streamlink', [...args])
    this.processes.set(recording.id, process)

    // 2. Confirma que subiu.
    await this.store.updateRecording(recording.id, { status: 'recording' })

    // 3. AGORA emite pro mundo externo saber.
    //    Se algum handler falhar aqui, estado interno já está correto.
    await this.emit({ type: 'started', recording })

  } catch (err) {
    // Se spawn falhou, marca no row antes de propagar — mantém consistência.
    await this.store.updateRecording(recording.id, {
      status: 'failed',
      failureReason: String(err),
    })
    throw err
  }
}
```

Ordem crítica:

1. Row criado (invariante) → **chamada direta ao store**
2. Processo spawnado (invariante) → dentro do Recorder
3. Row atualizado (invariante) → chamada direta ao store
4. Evento emitido (reação) → apenas depois de tudo consistente

Mesma lógica no finish:

```ts
private async onStreamlinkExit(recordingId: string, code: number) {
  // Fecha o row primeiro (invariante).
  await this.store.updateRecording(recordingId, {
    endedAt: new Date(),
    status: code === 0 ? 'completed' : 'failed',
    bytes: statSync(path).size,
  })

  // Depois notifica o mundo (reação).
  await this.emit({ type: 'finished', recordingId, exitCode: code })
}
```

## Divisão especulativa: o que é invariante e o que é reação

**Feito internamente pelo Recorder (invariante):**

- Criar/atualizar row em `recordings`
- Mover arquivo pra path final quando terminar (rename atomicamente pra
  refletir o `.ts` "completo")
- No boot do daemon: marcar `status: 'interrupted'` em rows órfãs (recovery
  de crash anterior). É invariante do boot, não do fluxo normal — mas mesma
  ideia: sem isso o estado fica inconsistente.

**Handlers de eventos externos (reação):**

- Rewrap TS → MP4 (job em background, retry seguro se falhar)
- Webhook Discord/Telegram
- Métricas / observabilidade
- Retention de disco (limpa arquivos antigos conforme política)
- Cloud sync (upload pra S3/Backblaze)
- Notificação de disco cheio (health check reagindo a `RecordingFailed` com
  reason ENOSPC)

## Teste mental antes de decidir "handler ou interno?"

> Se o daemon der crash **entre** completar a ação principal e chamar esse
> trecho, o sistema fica corrompido?

- **Sim** → tem que estar no fluxo principal, injeção direta, ordem controlada.
- **Não** → handler resolve, dá pra retry ou ignorar depois.

Handler é bom pra:

- Coisa que pode ser retry independente
- Cross-cutting concerns (log, métrica, notificação)
- "Gostaria que aconteça mas não é do meu core"

Handler **não** é bom pra:

- Manter invariante do agregado dono
- Coisa que se falhar em silêncio deixa estado divergente
- Trecho onde a ordem em relação à operação principal importa

## Consequência pra próxima iteração de eventos

Quando chegar a hora de refatorar do Estágio 1 pro Estágio 2 do
[events-evolution.md](./events-evolution.md), lembrar que **NEM tudo que
`recorder.on(...)` sugere é candidato**. Antes de mover algo pra handler,
aplicar o teste mental acima. Muitas responsabilidades que "parecem reação"
são na verdade invariantes disfarçadas.

E o oposto também vale: se o Recorder acabar tendo métodos internos que estão
claramente **respondendo** a algo (típico "após spawnar, fazer X, Y, Z" onde
X é core e Y/Z são só side effects nice-to-have), aí vale considerar promover
Y/Z pra listener explícito. Mas isso é conversa pra outro momento —
possivelmente depois de escrever o Recorder concreto e sentir onde a
responsabilidade tá inchando.

## Regra que fica

O invariante nunca vira listener. O listener nunca guarda invariante.
Se ficar em dúvida, o teste mental (crash entre) decide.
