# Work in Progress — guarda-chuva atual

Escopo em cima: **detectar quando um streamer sobe/desce ao vivo**. Sem gravação
ainda. As mini-tarefas abaixo caem todas dentro disso.

## Contexto que embasa as escolhas

- App **não é registrado** na Twitch → sem Helix, sem OAuth. Todas as requests
  vão pelo GQL anônimo (`https://gql.twitch.tv/gql` com o `Client-Id` público do
  web client `kimne78kx3ncx6brgo4mv6wki5h1ko`).
- Sem app registrado, **EventSub (WebSocket push) tá fora** — polling é o único
  caminho disponível.

## Como o polling deve ser feito

Três decisões que amarram o desenho antes de qualquer código do monitor:

### 1. Batch de canais numa query só

O `users(logins: [...])` do GQL aceita array. Uma request te dá o status de N
canais. **Não faz N requests separadas** (a menos que descubramos que `users` não
existe na GQL da Twitch — plano B são aliases GraphQL, mais chato mas viável).

```graphql
query($logins: [String!]!) {
  users(logins: $logins) {
    id
    login
    stream { id }
  }
}
```

Limite prático: uns 100 logins por query. Se der erro, quebrar em chunks.

### 2. `setTimeout` que se reagenda > `setInterval`

```ts
// ❌ ruim: se tick() demorar mais que o interval, sobrepõe
setInterval(tick, 30_000)

// ✅ bom: só reagenda depois de terminar; sem overlap
async function loop() {
  try { await tick() } catch (e) { logger.error(e) }
  timer = setTimeout(loop, 30_000)
}
```

`setInterval` dispara a cada N ms **independente** de quanto o callback demora.
Se tick() atrasar (rede lenta, 200 canais), acumula overlap. Reagendamento
explícito garante zero overlap.

### 3. Emitir eventos só quando o estado **muda**

O interessante não é "está ao vivo agora" — é **a transição** (offline → live).
É isso que aciona qualquer coisa reativa (futuramente, o gravador). Guardar o
estado anterior por canal e emitir `live`/`offline` só na virada.

```ts
for (const user of results) {
  const wasLive = states.get(user.login) === 'live'
  const isLive = user.stream !== null
  if (wasLive !== isLive) {
    emit(isLive ? 'live' : 'offline', user)
  }
  states.set(user.login, isLive ? 'live' : 'offline')
}
```

Sem isso, todo tick vira "está ao vivo" e o consumidor tem que filtrar. Deslocar
o filtro pra dentro do monitor deixa quem escuta trivial.

## Esboço do `ChannelMonitor`

```ts
export class ChannelMonitor {
  private timer: Timer | null = null
  private states = new Map<string, 'live' | 'offline'>()
  private listeners: Array<(e: MonitorEvent) => void> = []

  constructor(private twitch: TwitchClient, private intervalMs = 30_000) {}

  start(logins: string[]) {
    for (const l of logins) this.states.set(l, 'offline')
    this.loop()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
  }

  on(listener: (e: MonitorEvent) => void) {
    this.listeners.push(listener)
  }

  private async loop() {
    try { await this.tick() } catch (e) { console.error('monitor tick failed', e) }
    this.timer = setTimeout(() => this.loop(), this.intervalMs)
  }

  private async tick() {
    const logins = [...this.states.keys()]
    if (logins.length === 0) return
    const users = await this.twitch.getChannels(logins)
    for (const u of users) {
      const was = this.states.get(u.login)
      const now = u.stream !== null ? 'live' : 'offline'
      if (was !== now) {
        this.listeners.forEach(fn => fn({ type: now, login: u.login, at: new Date() }))
      }
      this.states.set(u.login, now)
    }
  }
}
```

## Intervalo sugerido

- **10-30s** — alta responsividade, mais requests, maior risco de rate limit anônimo.
- **1-2min** — sensato pra hobby / uso pessoal (perde ~90s do início na pior hipótese).
- **5min+** — economia extrema.

Começar em **30s**. Aumentar pra 60s se der 429.

## Peças que precisam existir antes do monitor rodar

1. **`TwitchClient.getChannels(logins: string[])`** — variante batched. Nova
   query, novo schema Zod `GetChannelsResponse`. Já discutimos como escrever a
   query com variable `[String!]!` e a reconciliação por `login` no retorno.
2. **Tipo `MonitorEvent`** — algo como `{ type: 'live' | 'offline', login: string, at: Date }`.
3. **No `main.ts`**: instanciar monitor, carregar canais do store,
   `monitor.start(logins)`, e no shutdown handler chamar `monitor.stop()` **antes**
   do `resolve()`.

## Como isso encaixa com o resto (referência pra depois)

- **Engine** vira o intermediário: escuta o `ChannelMonitor`, decide se aquele
  canal tem `autoRecord: true`, e no futuro spawna o gravador. Monitor não sabe
  de gravação; gravador não sabe de "how do I know it's live" — pergunta pro
  monitor.
- **Monitor é o oráculo da liveness**: quando o gravador (streamlink) morrer,
  Engine consulta monitor pra decidir "foi fim de live ou é transiente que preciso
  respawnar?". Ver `apps/daemon/notes/recording-twitch-streams.md`.

## Mini-tarefas (o que ainda falta pra fechar o guarda-chuva)

- [ ] Testar via curl/Bruno se `users(logins: [...])` existe na GQL da Twitch;
      se não, cair pra aliases.
- [ ] Criar schema Zod `GetChannelsResponse` em
      `apps/daemon/src/twitch/http/schemas/get-channels.ts`.
- [ ] Adicionar `getChannels(logins: string[])` em `TwitchClient` e
      `TwitchClientImpl` — batched, com `login` na seleção pra reconciliar.
- [ ] Implementar `ChannelMonitor` conforme esboço.
- [ ] Wire no `main.ts`: instanciar, carregar logins do store, `start`, e
      `stop()` no shutdown antes do `resolve()`.
- [ ] Definir `MonitorEvent` e como o Engine (ou algo temporário) escuta os
      eventos — inicialmente pode ser só `console.log` na transição pra ver que
      funciona; conectar ao Engine é outra iteração.
