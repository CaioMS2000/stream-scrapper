# Escalando a emissão de eventos: três estágios

Contexto: o daemon usa eventos internos pra comunicação desacoplada entre módulos
(Monitor → Recorder no primeiro caso, mas outros virão). Hoje o `ChannelMonitor`
mantém uma lista privada de listeners e implementa `on()` + `emit()` na própria
classe. Isso é o mínimo viável — mas conforme o número de produtores/consumidores
cresce, tem uma trajetória natural de refactor. Documento aqui os três estágios
pra saber quando promover.

## Estágio 1 — `on()` + `emit()` locais no produtor (estado atual)

Cada classe que emite eventos guarda os próprios listeners. O array de listeners,
o `on()` público, e o `emit()` privado (com try/catch por listener) vivem dentro
da classe.

```ts
export class ChannelMonitor {
  private listeners: MonitorListener[] = []

  on(listener: MonitorListener) { this.listeners.push(listener) }

  private async emit(event: MonitorEvent) {
    for (const listener of this.listeners) {
      try { await listener(event) }
      catch (err) { console.error('listener failed', err) }
    }
  }
}
```

**Quando fica bom:**
- Um produtor, poucos consumidores
- Composition root (`main.ts`) faz o wiring explícito

**Quando começa a doer:**
- Segundo produtor de eventos aparece e você repete essa mecânica lá dentro
- A cada nova classe emissora, você copia o mesmo array + on + emit

## Estágio 2 — `Emitter<T>` genérico reusável

Quando o padrão começa a se repetir em 2-3 classes diferentes, extrai a mecânica
pra um utilitário. Cada classe passa a **conter** um `Emitter<T>` em vez de
gerenciar o array/try-catch na mão.

```ts
export class Emitter<T> {
  private listeners: Array<(e: T) => void | Promise<void>> = []

  on(fn: (e: T) => void | Promise<void>) {
    this.listeners.push(fn)
  }

  async emit(e: T) {
    for (const fn of this.listeners) {
      try { await fn(e) }
      catch (err) { console.error('listener failed', err) }
    }
  }
}
```

E o Monitor vira:

```ts
export class ChannelMonitor {
  private events = new Emitter<MonitorEvent>()

  on(listener: MonitorListener) { this.events.on(listener) }
  // ...
  private async transition(event: MonitorEvent) {
    await this.events.emit(event)
  }
}
```

**Ganho:** mecânica deduplicada. Comportamento (isolamento de erro, ordem)
uniforme em todos os emissores.

**Ainda não é bus:** cada Emitter é local à sua classe. Ninguém "faz assinatura
global" — o consumidor precisa ter referência ao emissor.

**Quando fica bom:**
- 2+ produtores diferentes emitindo eventos próprios
- Cada consumidor conhece de qual produtor recebe

**Quando começa a doer:**
- Aparece cenário "consumidor genérico que quer escutar eventos de vários
  produtores sem depender de todos"
- Ou "produtor X quer emitir evento que Y (que ele não conhece) precisa reagir"

## Estágio 3 — `EventBus` central

Quando a rede de produção/consumo vira muito emaranhada, sobe pra um bus único
que roteia por **tipo de evento**. Cada evento é uma **classe** (ou tagged union
com discriminador tipo `type: 'live'`), e o roteamento usa esse marcador pra
saber quem chamar.

**Como o padrão se parece na prática:**

1. Eventos são **classes** — não interfaces, porque interfaces desaparecem em
   runtime e o roteador precisa de uma identidade concreta pra usar como chave
   no `Map`.

   ```ts
   export class ChannelLiveEvent {
     readonly occurredAt = new Date()
     constructor(readonly username: string) {}
   }
   ```

2. Existe **uma única instância de `EventBus`**, criada no composition root
   (`main.ts`) e injetada em produtores e consumidores.

   ```ts
   export class EventBus {
     private handlers = new Map<Function, Array<(e: any) => Promise<void>>>()

     subscribe<E>(EventClass: new (...args: any[]) => E, handler: (e: E) => Promise<void>) {
       const list = this.handlers.get(EventClass) ?? []
       list.push(handler as any)
       this.handlers.set(EventClass, list)
     }

     async publish<E extends object>(event: E) {
       const list = this.handlers.get(event.constructor) ?? []
       for (const handler of list) {
         try { await handler(event) }
         catch (err) { console.error('handler failed', err) }
       }
     }
   }
   ```

3. Produtores **publicam** sem saber quem escuta:
   ```ts
   await bus.publish(new ChannelLiveEvent('lexi'))
   ```

4. Consumidores **assinam** pela classe do evento:
   ```ts
   bus.subscribe(ChannelLiveEvent, async (e) => {
     await recorder.start(e.username)
   })
   ```

**O que muda em relação ao Emitter local:**

- Produtor não conhece consumidor **e vice-versa**. Ambos só conhecem o `bus`
  e o tipo do evento.
- Um evento pode ter N handlers em N módulos diferentes, sem coordenação.
- Adicionar um novo consumidor (ex: logger, métrica, notificação) é uma linha
  no composition root, zero alteração em produtor.

**Cuidados que não são triviais:**

- **Fluxo vira mais opaco**: pra saber quem trata `ChannelLiveEvent`, você tem
  que grep-ar todas as chamadas `bus.subscribe(ChannelLiveEvent, ...)`. IDE
  ajuda, mas não é `Cmd+Click` no produtor pro consumidor.
- **Isolamento de erro é obrigatório**: um handler bugado não pode derrubar os
  outros nem o `publish()`. Try/catch por handler no `publish`.
- **Ordem de execução**: sequencial (`for + await`) é debugável mas lenta;
  paralela (`Promise.allSettled`) é rápida mas ordem indefinida. Escolher
  conscientemente por caso de uso.
- **Herança de eventos**: subclasses de evento não disparam handlers da classe
  pai a menos que você caminhe o prototype chain no `publish` — decisão
  explícita.
- **Tipagem de handler**: no exemplo acima, o `subscribe` usa `EventClass` como
  chave e o TS narrowingo funciona. Se em vez disso você usasse string
  (`subscribe('channel.live', ...)`), perde exhaustive checking — os eventos
  viram strings mágicas.

**Quando faz sentido:**
- Rede de produção/consumo multi-módulo (3+ produtores E 3+ consumidores)
- Cross-cutting concerns (log, métrica, audit) que interceptam eventos de
  múltiplas fontes
- Consumidores dinâmicos (plugin system, features opcionais que se registram
  se habilitadas)

**Quando NÃO faz sentido:**
- Fluxo linear e conhecido (Monitor → Recorder e mais nada) — Estágio 1/2 é
  mais explícito
- Cross-process (aí você quer message queue de verdade tipo Redis Pub/Sub,
  RabbitMQ, Kafka — bus in-memory não resolve)

## Emitter vs EventBus: comparação prática lado a lado

Um erro comum é ler "Estágio 2 → Estágio 3" e concluir que Bus é sempre "mais
poderoso" e Emitter é só "temporário". Não é bem assim — os dois operam em
planos diferentes e cada um vence em cenários distintos. Esta seção compara
com código concreto.

### Modelo mental

- **Emitter é um cano.** Um pipe direto entre um produtor e seus assinantes.
  Simples, tipado, óbvio. Quem quer escutar precisa ter referência ao dono
  do cano.
- **EventBus é uma central telefônica.** Vários produtores publicam, vários
  consumidores escutam, roteamento por número (tipo do evento). Mais poder,
  mais opacidade, requer disciplina.

### O que EventBus faz que Emitter não faz

#### 1. Consumidor não precisa conhecer o produtor

Com Emitter, pra escutar você **precisa** da referência ao produtor:

```ts
monitor.on(handler)  // preciso ter 'monitor' em escopo
```

Com Bus, você conhece só a classe do evento — nem precisa saber que existe
um `ChannelMonitor` no sistema:

```ts
bus.subscribe(ChannelLiveEvent, handler)  // nem sei quem publica isso
```

Isso permite módulos "plug-in" que se inscrevem sem tocar em `main.ts` nem
receber injeção do produtor.

#### 2. Múltiplos produtores emitindo o mesmo tipo de evento

Cenário: tanto Monitor quanto Recorder publicam `TelemetryEvent` (genérico
"algo relevante aconteceu"). Consumidor único que registra todos.

Com Emitters (impossível compartilhar tipo entre produtores diferentes):

```ts
// Cada produtor tem seu Emitter<TipoEspecífico> — tipos incompatíveis
monitor.on(handleTelemetry)   // recebe MonitorEvent
recorder.on(handleTelemetry)  // recebe RecorderEvent
// Consumidor tem que amarrar nos dois E lidar com tipos diferentes
```

Com Bus (o mesmo handler recebe dos dois):

```ts
bus.subscribe(TelemetryEvent, handleTelemetry)
// Monitor faz: await bus.publish(new TelemetryEvent(...))
// Recorder faz: await bus.publish(new TelemetryEvent(...))
// Handler recebe dos dois, sem saber quem publicou
```

#### 3. Cross-cutting concerns: "escuta tudo"

Cenário: logger central que registra todo evento do daemon.

Com Emitters, precisa amarrar em cada produtor manualmente:

```ts
monitor.on(e => logger.log('monitor', e))
recorder.on(e => logger.log('recorder', e))
store.on(e => logger.log('store', e))
// Adicionou produtor X? Tem que lembrar de wire aqui — bug latente.
```

Com Bus, uma linha catch-all:

```ts
bus.subscribe(Event, e => logger.log(e))  // Event = classe raiz
// Novo produtor publicando no bus → logger vê automaticamente.
```

Mesma lógica pra métricas Prometheus, audit trail persistente, etc.

#### 4. Roteamento por tipo do evento

Emitter emite tudo pra **todos** os listeners inscritos — filtragem é
responsabilidade do handler:

```ts
monitor.on(e => {
  if (e.type === 'live') handleLive(e)
  else handleOffline(e)  // handler filtra na entrada
})
```

Bus roteia por identidade do tipo — cada handler só recebe o que assinou:

```ts
bus.subscribe(ChannelLiveEvent, handleLive)        // só live chega aqui
bus.subscribe(ChannelOfflineEvent, handleOffline)  // só offline aqui
```

### O que Emitter faz melhor que EventBus

Não é lista curta pra dar "peso equivalente" — são vantagens reais que fazem
Emitter continuar sendo a escolha certa em muitos cenários mesmo depois que
Bus estiver disponível no projeto.

#### 1. Ownership claro na leitura do código

Cada produtor tem seu Emitter. Lendo `ChannelMonitor`, você **vê** o Emitter
como campo/prop — sabe imediatamente que ele emite eventos. Com Bus, produtor
chama `bus.publish(...)` como um método qualquer, e você precisa procurar
essas chamadas pra mapear quem publica o quê.

#### 2. Type safety sem magic de runtime

`Emitter<MonitorEvent>` é tipado no compilador — TS sabe o shape exato,
tagged union narrowing funciona automático dentro de handlers, refactor
seguro.

Bus roteia por `event.constructor` como chave em `Map`. Isso força:

- Eventos serem **classes** (não interfaces — interfaces somem em runtime
  e não têm constructor identity)
- Casts internos `handler as (e: any) => void` pra guardar handlers
  heterogêneos no mesmo Map
- Narrowing por tipo mais frágil e verboso

Funciona, mas TS "trabalha menos" — mais chance de bug passar despercebido.

#### 3. Traceabilidade com IDE

`Cmd+Click` no `.on()` de um Emitter te leva à assinatura, e "Find All
References" mostra quem chama. Com Bus:

- `bus.subscribe(SomeEvent, ...)` pode estar em N arquivos
- Grep pela classe do evento, filtrar por chamadas de subscribe
- IDE ajuda menos porque é dispatch dinâmico

Não é impossível, é só mais custoso.

#### 4. Zero estado global mutável

Cada Emitter é escopado à sua classe dona. Vazamentos, listeners esquecidos,
comportamento inesperado — tudo isolado. Bus é objeto compartilhado: um
handler mal comportado que adiciona listeners em loop afeta todo mundo.

### Tabela decisiva

| Cenário | Escolha certa |
|---|---|
| 1-to-N (um produtor conhecido, consumidor específico) | **Emitter** |
| N-to-1 (poucos produtores conhecidos, consumidor único) | **Emitter** |
| N-to-N com produtores/consumidores anônimos entre si | **Bus** |
| Cross-cutting (logger, métrica, audit escutando tudo) | **Bus** |
| Plugin system / auto-registro dinâmico | **Bus** |
| Consumidor auto-inscrito sem tocar em `main.ts` | **Bus** |
| Fluxo linear e conhecido (Monitor → Recorder e mais nada) | **Emitter** |

### Resumindo

Emitter e Bus não são "simples" e "complexo" da mesma escala — são
ferramentas com propósito diferente. Bus **não deprecia** Emitter; ele
resolve um problema (N-to-N desacoplado) que Emitter deliberadamente não
resolve pra manter as vantagens acima. Num daemon maduro, os dois podem
coexistir: Emitters locais pra fluxos diretos + Bus pra cross-cutting.

## O que mantém a migração barata

**A superfície pública do consumidor não muda entre os estágios.**

- Estágio 1: `monitor.on(handler)`
- Estágio 2: `monitor.on(handler)` (delega ao Emitter interno)
- Estágio 3: `bus.subscribe(ChannelLiveEvent, handler)` — só aqui o call site
  precisa mudar, e é fácil localizar

Ou seja: você não é preso pela decisão inicial. Escolher **listener local hoje**
não custa refactor grande quando migrar amanhã — só troca o miolo do
`emit()`/`on()` da classe, os call sites do `on()` continuam iguais.

## Regra prática de quando promover

| Cenário atual | Estágio |
|---|---|
| 1 produtor de eventos, ≤ 3 consumidores conhecidos | **1 (local)** |
| 2-3 produtores, mecânica se repetindo | **2 (Emitter genérico)** |
| Rede multi-produtor/multi-consumer, consumidores anônimos | **3 (EventBus)** |
| Cross-process, garantia de entrega, retry | **fora do escopo in-memory** — usar MQ |

Traduzindo pro daemon hoje: **Estágio 2**. Existe um `Emitter<T>` genérico
compartilhado em `@shared/events`, e o `ChannelMonitor` **recebe** um
`Emitter<MonitorEvent>` por injeção no construtor (junto com `twitch` e
`store`). Foi promoção antecipada — motivada pela expectativa próxima do
Recorder também emitir eventos próprios, então quando ele chegar já herda o
utilitário sem refactor.

**Convenção de injeção (decisão consciente):** o Emitter poderia ser
instanciado internamente pela própria classe (`new Emitter()` como campo
privado). Escolhemos injetar por consistência com as outras dependências,
aceitando o custo de cerimônia extra na composição e nos testes. A
contrapartida da injeção é uma **regra rígida**: **nunca compartilhar a
mesma instância de Emitter entre classes emissoras**. Cada Monitor, Recorder,
etc. tem a sua. Se sentir vontade de reusar uma instância entre produtores,
isso é sinal pra promover pro Estágio 3, NÃO pra contornar a convenção.

Estágio 3 (EventBus central) só entra em pauta quando aparecer o cenário
"quero escutar eventos de vários produtores sem depender de cada um deles" —
hoje ainda não é o caso.

## Referências no código

- **Utilitário compartilhado** (Estágio 2): [apps/daemon/src/@shared/events/emitter.ts](../src/@shared/events/emitter.ts) — `Emitter<T>`, `Listener<T>`
- **Uso atual** (Monitor recebendo Emitter via DI): [apps/daemon/src/monitor/monitor.ts](../src/monitor/monitor.ts) — `ChannelMonitorProps.events: Emitter<MonitorEvent>` com JSDoc reforçando a regra do "não compartilhar"
- **Tipo dos eventos do Monitor**: [apps/daemon/src/monitor/type.ts](../src/monitor/type.ts) — `MonitorEvent`, `MonitorListener`
