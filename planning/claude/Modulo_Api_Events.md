# Módulo `api` + `events` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha a **fronteira** — a faixa teal do diagrama, o contrato que a UI acopla. O catálogo de rotas já está na seção 4 da arquitetura; aqui o foco é o **design da camada**: estrutura, fluxo de eventos, proxy HLS e segurança do servidor local. Ainda **language-agnostic**.

---

## 1. Papel e princípio

A camada `api`/`events` expõe o motor headless ao mundo por três planos:

1. **Controle (REST)** — comandos e leituras.
2. **Eventos (WebSocket)** — atualizações empurradas em tempo real.
3. **Dados (proxy HLS + arquivos)** — pra assistir ao vivo e reproduzir o que já está no disco.

É o **único** módulo exposto pra fora do processo, e é deliberadamente **fino**: traduz HTTP/WS em chamadas nos outros módulos e traduz eventos internos em mensagens WS. Não tem lógica de negócio própria.

---

## 2. O princípio da finura (por que sem lógica de negócio)

A `api` é cola: `rota → valida → chama módulo → serializa resposta`. Nada além disso. A razão é a mesma de tudo: o **contrato** (seção 4 da arquitetura) é a parte cara de mudar. Se lógica de negócio vazasse pra cá, trocar o motor pra Go significaria re-derivar essa lógica aqui também. Mantendo a camada quase **mecânica** — um restatement limpo do contrato — a reimplementação fica barata, e o contrato permanece estável enquanto o miolo é trocável.

---

## 3. Plano de controle (REST)

Estrutura: handlers finos que embrulham `store`/`monitor`/`recorder`/`downloader`. Três cuidados:

- **Validação na fronteira.** Valide todo input aqui, em runtime. É a lição direta da "parede do type erasure" do mapa de linguagens: tipos de TS somem em runtime e **não validam** dado externo. Então a fronteira valida com um validador de runtime (Zod e afins), nunca confia na tipagem estática pra dado que entra.
- **Serialização via DTO.** Mapeie tipos internos → JSON limpo; **não vaze** campos internos (handles de processo, caminhos absolutos sensíveis).
- **Idempotência** nos endpoints de ação (disparar download duas vezes não cria dois jobs).

---

## 4. Plano de eventos (WebSocket + o módulo `events`)

### O barramento interno `events`

Um pub/sub interno que **desacopla** produtores de consumidores:

```
events.publish(type, data)         -- o recorder publica recording.progress
events.subscribe(handler) -> unsub -- a api assina e repassa pro WS
```

O ponto-chave: **o `recorder` não conhece WebSocket**. Ele só publica no barramento; a `api` assina e faz o fan-out. Isso mantém os módulos limpos e deixa a porta aberta pra outros consumidores depois (log, notificações, uma futura CLI) sem tocar nos produtores.

### A ponte pro cliente

A `api` assina o barramento e faz fan-out pros clientes WS conectados, num envelope único `{ type, ts, data }` (seção 4 da arquitetura).

**Padrão snapshot-then-stream.** Ao conectar, o cliente primeiro recebe um **snapshot** do estado atual (gravações ativas, downloads em curso) e *depois* o fluxo de deltas. Isso evita a UI perder estado que aconteceu antes de ela conectar.

**Reconexão = re-snapshot.** Os eventos **não** são persistidos nem reproduzidos (é um barramento vivo, não um log). Na reconexão, o cliente re-busca o estado autoritativo via REST e segue ouvindo deltas. Ou seja: **WS pros deltas ao vivo, REST pro estado autoritativo** — a UI reconcilia. É mais simples que um log com replay, e apropriado pra ferramenta local single-user.

---

## 5. Plano de dados (assistir + reproduzir)

Dois sub-casos distintos:

### a) Proxy HLS — assistir **ao vivo**

Por que existe: o hls.js no browser **não** consegue buscar o manifesto ao vivo da Twitch direto (CORS + exige token + Client-ID). O proxy deixa o motor (que tem o token via `twitch`) buscar no lugar do browser.

- `GET /api/live/:login/playlist.m3u8` → motor chama `twitch.resolveLiveManifest` → reescreve as URLs dos segmentos pra apontar de volta ao proxy (`/api/live/:login/segment/:id`) → devolve ao hls.js.
- `GET /api/live/:login/segment/:id` → proxia o `.ts` da CDN (motor busca, faz streaming através).
- **Refresh de token:** como o token live expira, o proxy re-resolve quando preciso (mesma preocupação de stream longa do `recorder`, mas pra quem está assistindo).
- Assistir e gravar são **consumidores independentes** da mesma fonte no MVP (otimização de "tee" fica pra depois).

### b) Servir arquivo — reproduzir o que **já está no disco**

Pra tocar `recording.mp4`/`vod.mp4` já capturados:

- `GET /api/files/:streamId/:kind` → faz streaming do arquivo do disco **com suporte a HTTP Range** (essencial pro `<video>` poder dar seek/scrub). Distinto do proxy ao vivo — aqui é só servir estático com range.

---

## 6. Servir a UI (mesma origem)

O motor serve o **bundle React buildado** como estático em `/`, e a API em `/api/*`. Origem única → **zero CORS** pra UI↔API. Você abre `localhost:<porta>` → recebe a UI → a UI fala com a API da mesma origem. É o modelo qBittorrent/Jupyter: um daemon local servindo o painel. Sem Tauri/Electron.

---

## 7. Segurança do servidor local (importa mais do que parece)

Local **não** significa seguro por padrão — esse servidor segura sua sessão da Twitch (`cookies.txt`) e pode gastar sua banda. Mínimos:

- **Bind só em `127.0.0.1`**, nunca `0.0.0.0` — não exponha na rede.
- **DNS rebinding / CSRF:** um site malicioso aberto no seu browser pode tentar bater na sua API local. Mitigação: checar headers `Origin`/`Host` e exigir um **token de sessão** que o motor injeta na UI ao servi-la; rejeitar requisição sem ele. Isso importa porque a API dispara downloads, lê config e toca a sessão.
- **Nunca exponha o conteúdo do `cookies.txt`** por nenhum endpoint. A sessão é sensível; ela entra (import) e é usada, mas não sai.

---

## 8. Mapeamento de erros

Resultados internos → HTTP, com envelope consistente `{ error: { code, message } }`:

| Interno | HTTP | UI mostra |
|---|---|---|
| validação falhou | 400 | "input inválido" |
| `Forbidden` (caminho 1, não é sub) | 403 | "sub-only e você não é inscrito" |
| `NotOnCdn` / `NotFound` | 404 | "expirou da CDN" / "não encontrado" |
| `Unavailable` (resolver esgotou) | 404/410 | "irrecuperável" (o limite físico da seção 8 da arquitetura) |
| erro do motor | 500 | "falha interna" |

Os desfechos do resolver mapeados pra status distintos é o que deixa a UI **explicar** o porquê — "sub-only sem inscrição" vs "expirou da CDN" são coisas diferentes pro usuário.

---

## 9. Interface interna (language-agnostic)

```
start(port)              -> void     -- registra rotas + WS + proxy + estático
stop()                   -> void

-- barramento (módulo events)
events.publish(type, data)
events.subscribe(handler) -> unsubscribe
```

---

## 10. O que fica adiado

- **Auth de verdade** (além do token de sessão local) — só se virar "frota" hospedada com acesso remoto. Pro MVP local, token de sessão + bind em localhost bastam.
- **Replay/persistência de eventos** — hoje é re-snapshot na reconexão.
- **Rate limiting da própria API** — single-user, desnecessário.
- **HTTPS** — local não precisa; se um dia for remoto, sim.
- **Tee proxy→recorder** (assistir e gravar compartilhando uma única busca da fonte) — otimização.

---

*Spec da camada `api`/`events` — versão inicial. Com ela, o motor está completo: headless por dentro, exposto por um contrato fino e estável. Só falta a UI consumir esse contrato.*
