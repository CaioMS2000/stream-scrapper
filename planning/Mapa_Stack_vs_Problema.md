# Mapa de Decisão: Proposta de Aplicação × Stack Técnica

> **Documento de referência consolidado.** Reúne num só lugar o raciocínio espalhado pelas conversas sobre Discord, apps companheiros de jogo (Blitz e cia.), o produto de voz *Premade* e o mapa de linguagens (Tauri, Java/Kotlin, JS/TS, vocabulário de latência).
>
> **Como usar:** quando surgir uma proposta de aplicação nova, percorra os **5 eixos de decisão** (seção 3) usando a **régua de medição** (seção 4) como linguagem comum, consulte o **mapa de linguagens** (seção 5) pra ver qual slot o problema ativa, e valide contra a **tabela de anti-padrões** (seção 9). Os **estudos de caso** (seção 10) são exemplos completos já resolvidos pra calibrar a intuição.

---

## 1. O princípio central

**Tecnologia não tem "melhor" — tem "melhor pra qual formato de problema".** Uma escolha de stack só faz sentido quando você termina a frase com *"…pra qual problema"*.

A ilustração mais limpa disso é o **Go**, que aparece como vilão e herói na mesma cadeia de raciocínio:

- **Vilão (Discord / Read States):** Go foi abandonado porque o serviço juntava três coisas raras ao mesmo tempo — escala absurda, exigência de p99 baixíssimo e um *heap gigante e vivo* na memória. Isso é o pior cenário possível pro garbage collector, que pausava periodicamente pra varrer aquela montanha de objetos → picos de latência na cauda.
- **Herói (Blitz / API de leitura):** o mesmo Go é quase perfeito, porque o workload é o oposto — leitura *stateless* de dados pré-computados, cacheável no Redis/CDN, sem heap quente pra varrer. O motivo que reprovou o Go lá é o que o aprova aqui.

Mesma linguagem, veredito invertido. **A única coisa que mudou foi o formato do problema.**

---

## 2. As três perguntas que destravam toda decisão

Antes dos eixos formais, o atalho mental que resume tudo:

1. **Onde mora o peso?** No servidor ou no cliente?
2. **Qual o formato do estado?** Heap quente e vivo, estado efêmero externo, ou leitura stateless cacheável?
3. **O que a latência exige?** Que *nenhuma* requisição estoure o teto (p99 sagrado), ou a média já resolve?

---

## 3. Os 5 eixos de decisão

A escolha de stack é função de **problema × time × futuro**. Os três primeiros eixos são do *problema*; os dois últimos são o que impede o mapa de virar dogma.

| # | Eixo | Pergunta | Empurra para… |
|---|------|----------|---------------|
| 1 | **Onde mora o peso** | Servidor (fan-out de conexões, entrega de dados) ou cliente (UI, overlay, ler APIs locais, capturar áudio)? | Servidor pesado → BEAM/Elixir, Go, JVM. Cliente pesado → Tauri/Rust + TS, Electron/TS. |
| 2 | **Formato do estado** | Heap quente e *vivo* em memória? Estado efêmero externo (Redis)? Leitura stateless cacheável? | Heap vivo + p99 → sem GC (Rust/C++). Efêmero/I/O-bound → event loop (Node). Stateless cacheável → Go. |
| 3 | **Exigência de latência** | p99/p99.9 sagrado sob carga, ou latência média basta? | p99 sagrado → linguagem sem GC. Média basta → Go, Node, JVM. |
| 4 | **Time (expertise)** | A equipe *já domina* alguma linguagem que resolve o problema bem o suficiente? | "A gente já entrega isso amanhã" frequentemente ganha do "encaixe teórico perfeito". |
| 5 | **Futuro (trajetória)** | O produto vai ficar pequeno e focado, ou crescer pra plataforma com domínio de negócio complexo, billing, moderação/T&S em escala? | Pequeno/focado → minimize linguagens. Vai crescer → a JVM (Java/Kotlin) sai de "dominada" pra "faz sentido". |

> **A distinção mais madura do mapa:** separar *"a linguagem não cabe no problema"* de *"a linguagem não cabe no time"*. São rejeições diferentes, com consequências diferentes. Expertise de equipe e "uma linguagem a menos" são **forças de engenharia legítimas**, não desculpas.

---

## 4. A régua de medição (vocabulário rigoroso)

Sem esse vocabulário, "rápido/lento" é conversa vazia. Com ele, as decisões dos eixos ficam objetivas.

### Throughput × Latência — eixos independentes

- **Throughput (vazão):** uma *taxa* — quantas operações por segundo o sistema processa. Propriedade do sistema inteiro. *"Quantos cabem por segundo?"*
- **Latência:** o tempo de *uma* operação. Propriedade da requisição individual. *"Quanto demorou essa aqui?"*

**Analogia do caixa de supermercado:** throughput é quantos clientes passam por hora; latência é quanto *você* esperou na fila. São independentes — dá pra ter vazão altíssima (10.000/hora) e mesmo assim 1 em 100 esperar 40 minutos. **Vazão alta não garante espera baixa.**

### Percentis — latência não é um número só

Você mede a *distribuição* inteira e descreve com percentis. `pN` = "N% das requisições foram tão rápidas quanto isso ou mais rápidas".

- **p50 (mediana):** o "típico", o que a maioria sente. Mora na parte gorda da distribuição.
- **p1:** a ponta veloz, quase-melhor-caso. **Informação morta na prática** — ninguém reclama de ser rápido demais, então ninguém monitora.
- **p99:** a estrela. Vive na **cauda** (*tail latency*). 99% foram mais rápidas; o 1% pior passou disso. Toda a dor de um sistema em tempo real mora ali.

### O insight que faz o p99 virar obsessão

**Em escala, a cauda vira a experiência típica.** Se carregar uma tela dispara 100 chamadas de backend e a tela só aparece quando *todas* voltam, a chance de pelo menos uma cair no p99 **não é 1%** — é `1 − 0,99¹⁰⁰ ≈ 63%`. Quase toda tela bate na cauda. Quanto mais chamadas por ação do usuário, mais fundo na cauda vive a realidade dele (por isso se mede p99, p99.9, p99.99).

**A média mente; os percentis não.** Um sistema com p50 de 10 ms e p99 de 2000 ms pode ter média "ok" enquanto a experiência real de muita gente é horrível. **Ninguém sério usa média de latência.**

### Garbage Collector: estatístico × determinístico

- **GC (Go, JVM, V8/Node):** ótima média e ótimo p50, mas a coleta periódica cria *spikes* que aterrissam na cauda → destrói o p99 sob carga adversária com heap grande.
- **Refinamento honesto:** o reflexo "GC = cauda ruim" está **datado**. Coletores modernos (ZGC, Shenandoah) desacoplam a pausa do tamanho do heap → pausas sub-milissegundo mesmo em heaps enormes. Mas a palavra certa é **mitigar, não eliminar**: a pausa mudou de forma (de *stop-the-world* discreto pra imposto difuso de CPU/largura de banda + *write barriers*), e o ganho depende de **folga de memória** (*headroom*).
- **A diferença é filosófica:** GC concorrente dá cauda excelente, mas é **estatístico** (o coletor tem que acompanhar a alocação). Rust (RAII/ownership, libera no fim do escopo) é **determinístico** — sem coletor pra ficar pra trás, garantia absoluta em vez de probabilística. No fundo da cauda, sob carga adversária ou memória apertada, o determinístico ainda ganha.
- **Ressalva:** GC não é a *única* fonte de cauda. Partição quente, enfileiramento, *cache miss* e contenção criam cauda mesmo com coletor perfeito. Resolver GC mitiga uma fatia; sharding, *hedging* e *coalescing* continuam sendo trabalho de arquitetura.

---

## 5. O mapa das linguagens

Cada linguagem ocupa um **slot** definido pelo formato de problema que ativa as forças dela.

| Linguagem / Plataforma | Slot (o que ativa as forças) | Mecanismo | Trade-off / onde quebra |
|---|---|---|---|
| **Elixir / Erlang (BEAM)** | Fan-out *stateful* tolerante a falha em escala: milhões de conexões WebSocket persistentes, presença, entrega em tempo real | Milhões de processos leves e isolados; árvore de supervisão (um que morre não derruba vizinhos) | Não é pra CPU-bound pesado nem cálculo; ecossistema menor; só compensa quando há *fan-out stateful* de verdade |
| **Rust** | Latência determinística, controle fino de memória, núcleo nativo: dados em partição quente, cliente WebRTC, captura de áudio, leitura de APIs locais | Sem GC (ownership/RAII); "fearless concurrency"; binário enxuto | Velocidade de desenvolvimento menor; curva/borrow checker; hiring mais difícil; over-engineering pra CRUD trivial |
| **Go** | Backend *stateless* read-heavy e cacheável; serviços de rede; deploy trivial; alto throughput com concorrência simples | Compilado nativo, goroutines, simplicidade operacional | GC força coleta periódica → estoura p99 se houver **heap gigante e vivo** + exigência de p99 (o caso Discord) |
| **Java / Kotlin (JVM)** | (a) Sistema de negócio complexo, time grande, anos de manutenção, ecossistema maduro (Spring); (b) espinha dorsal de big data (Kafka, Spark, Elasticsearch) | JIT → vazão perto do nativo; ecossistema de 25 anos; virtual threads (Loom) encostam no território de concorrência | Herda GC → perde pro Rust onde p99 é sagrado (foi o motivo do Cassandra→ScyllaDB); footprint/startup da JVM pesa pra produto pequeno |
| **Python** | Crunch de dados, ML/inferência, ciência de dados, scripting analítico | Ecossistema científico/ML dominante; libs nativas (C/C++) por baixo fazem o trabalho pesado | Lento puro; GIL; não é pra serviço de baixa latência nem alta concorrência de CPU |
| **JS / TS — camada de interface** | Qualquer UI em navegador ou webview (web, Electron, Tauri, React Native) | **Monopólio estrutural** — é a única linguagem que roda nativo no navegador | Não é escolha, é *física*: se a superfície é um webview, a linguagem ali dentro é JS/TS |
| **JS / TS — Node (servidor)** | Cola de I/O: muitas conexões concorrentes que passam o tempo *esperando* I/O (API gateway, BFF, WebSocket, proxy); full-stack isomórfico com tipos compartilhados; edge/serverless | Event loop de thread única, I/O não-bloqueante; isolates V8 sobem em ms (sem warmup de JIT) | **Trava o processo inteiro** em qualquer CPU-bound; sem paralelismo real de memória compartilhada; sem isolamento/supervisão do BEAM |

### Notas por slot

**TS vs JS:** o TypeScript é "o JS que cresceu pra aguentar time grande" — tipagem estática em tempo de compilação que torna o JS viável na escala onde antes você pegaria Java/C#. Mas os tipos são **apagados em runtime** (*type erasure*): não validam dado externo (API, input, banco, JSON) — pra isso precisa de validação de runtime (Zod e afins) na fronteira. É produtividade, não prova matemática.

**Bancos/infra como "linguagem":** SQL e Redis não contam como "linguagem que você mantém" no sentido de contratação. Voz adotada (LiveKit/coturn) também não entra na contagem de linguagens do time.

---

## 6. Frameworks de cliente desktop: Tauri × Electron

Decisão recorrente em qualquer app com overlay/desktop. **Ambos** usam TS no frontend; a diferença é o backend e o webview.

| | **Tauri** | **Electron** |
|---|---|---|
| Frontend | Web (JS/TS + React/Vue/Svelte) | Web (JS/TS) |
| Backend / core | **Rust** | **Node.js** (main process) |
| Webview | **Do sistema** (WebView2 / WKWebView / WebKitGTK) | **Chromium embutido** |
| Binário / RAM | Poucos MB, leve | ~80–150 MB, mais pesado |
| Overlay sobre jogo | Performance superior (motivo de existir pra jogo competitivo) | Overhead de FPS — reclamação crônica |
| WebRTC / `getUserMedia` | **Inconsistente cross-platform** (Windows ok via WebView2; macOS capenga; Linux o mais fraco) | **Confiável** (Chromium embutido, igual ao Chrome) |

**A bifurcação que isso cria (e que decidiu o Premade):**
- **Tauri →** aceite Rust no engine de áudio (mantém a performance do overlay). O `getUserMedia` no webview do sistema é loteria por plataforma; pra produto de voz isso é arriscado demais, então WebRTC + captura vão pra Rust (`webrtc-rs` / SDK Rust do LiveKit + `cpal`).
- **Electron →** empurra quase tudo pra TS (chega perto de uma linguagem só), mas paga no FPS do overlay.
- **Não existe** "Tauri + voz confiável em TS" ao mesmo tempo. É um ou outro.

---

## 7. Bancos e infraestrutura (referência rápida)

| Componente | Quando | Observação |
|---|---|---|
| **Postgres** | CRUD, identidade, dados relacionais com integridade | Default sólido pra business layer |
| **Redis** | Estado efêmero, presença, salas, cache, rate-limit distribuído | Tira o "heap quente" da aplicação → favorece event loop (Node) |
| **Cassandra** | Escala massiva de escrita | Escrito em **Java** → GC estoura p99 na compactação (Discord fugiu dele) |
| **ScyllaDB** | Mesma API do Cassandra, sem a JVM | Reescrita em **C++** (drivers Rust) pra escapar do GC |
| **Kafka / Spark / Elasticsearch** | Pipeline de big data, ingestão em fila, processamento em massa | Roda na **JVM** — é onde a JVM reaparece num produto client-heavy |
| **LiveKit / coturn (WebRTC SFU + Opus)** | Voz/vídeo em tempo real | Infra adotada, não "linguagem mantida"; um SFU customizado é o que o Discord faz |

---

## 8. Fluxo de decisão prático (o passo a passo pra cruzar proposta × stack)

Dada uma **proposta de aplicação nova**, percorra na ordem:

1. **Onde nasce e mora o dado?** Servidor (fan-out) ou cliente (lê de terceiros/local)? → define se o peso é backend ou cliente.
2. **Tem fan-out *stateful* em escala?** Milhões de conexões persistentes com entrega em tempo real? **Sim →** BEAM/Elixir entra. **Não →** esqueça BEAM (carregaria complexidade de um problema que você não tem).
3. **O backend tem heap grande e vivo + exige p99 apertado?** **Sim →** linguagem sem GC (Rust). **Não →** Go/Node/JVM resolvem.
4. **O trabalho é I/O-bound (esperar banco/API/rede) ou CPU-bound (triturar dados)?** I/O-bound de muitas conexões → **Node**. CPU-bound/ML → **Python/JVM/Rust** (Node trava).
5. **A superfície de UI é um webview?** **Sim →** o frontend é JS/TS por física. Escolha Tauri (overlay/leveza, aceita Rust no nativo) vs Electron (WebRTC/mic confiável, paga FPS).
6. **Qual a régua de latência?** p99 sagrado sob carga → sem GC no caminho quente. Média basta → o leque abre.
7. **Cruze com o TIME:** alguma das opções viáveis o time *já domina*? Se sim, ela ganha peso real (entrega amanhã > encaixe teórico).
8. **Cruze com o FUTURO:** vai virar plataforma com negócio complexo, billing e moderação/T&S em escala? Se sim, a JVM (Java/Kotlin) deixa de ser "dominada" e passa a fazer sentido; Kafka/Spark podem entrar.
9. **Minimize linguagens conscientemente:** para cada peça, pergunte qual *resiste* a ser absorvida por outra. A que sobra como inevitável (ex.: Rust pro áudio no Tauri) é o custo real da arquitetura escolhida — registre como decisão consciente.

---

## 9. Tabela de anti-padrões ("não use")

| Não use… | Para… | Porque (mecanismo) | Vá para… |
|---|---|---|---|
| **JS/TS (Node)** | Cálculo pesado, crunch de dados, ML, processamento de imagem/vídeo, agregações gigantes | Thread única — CPU-bound congela o processo inteiro; sem paralelismo real de memória compartilhada | Python (libs nativas), JVM, Go, Rust |
| **JS/TS** | Kernel, driver, firmware, loop quente de game engine, HFT, latência determinística ao microssegundo | V8 tem GC + JIT — sem controle de memória, comportamento não-determinístico | Rust, C, C++ |
| **JS/TS (ingenuamente)** | Dinheiro e matemática exata | `number` é float IEEE 754 de 64 bits; `0,1 + 0,2 ≠ 0,3`. **TS não conserta** — `number` do TS *é* o float do JS | Inteiros (centavos), libs de decimal; Java `BigDecimal`, Python `Decimal` |
| **Confiar no TS como validação** | Validar dado externo (API, input, banco, JSON) | Tipos apagados em runtime (*type erasure*) + sistema deliberadamente não-sólido (`any`, `as`) | Validação de runtime na fronteira (Zod e afins) |
| **JS/TS (Node)** | Fan-out stateful tolerante a falha em escala | Sem isolamento de processo nem árvore de supervisão; um erro pode derrubar o processo | BEAM/Elixir |
| **Go** | Serviço com heap gigante e vivo + p99 sagrado | GC força coleta periódica varrendo a montanha viva → spikes na cauda | Rust, C++ |
| **Java/Kotlin (JVM)** | Produto pequeno, stateful, em tempo real, time enxuto | Footprint/startup da JVM + ecossistema corporativo pesam; é "dominado" por Elixir (real-time) e Go (simplicidade) | Elixir, Go — *salvo* expertise de time ou futuro grande |
| **BEAM/Elixir** | App client-heavy que só faz polling de dados pré-computados | A justificativa do BEAM (fan-out stateful) não existe; vira complexidade sem pagamento | Go (servir leitura) + Python (crunch) |
| **Rust** | CRUD trivial num backend pequeno | Verboso/lento de escrever pra trabalho banal | Go (rindo) ou Node — *salvo* já estar comprometido com Rust no cliente |

> **Aviso meta:** a *ubiquidade* do JS te tenta a usá-lo onde o problema o rejeita. O apelo do "uma linguagem só, full-stack, tipos compartilhados" faz times empurrarem JS pra dentro de carga CPU-bound, financeira ou de baixo nível só pra não trazer uma segunda linguagem — e batem em todas as paredes de uma vez. A disciplina é enxergar **onde o encaixe acaba** antes de cruzar a fronteira sem querer.

---

## 10. Estudos de caso (exemplos completos já resolvidos)

### 10.1 Discord — peso no servidor

- **Forma do problema:** fan-out stateful em escala extrema; "hot partitions" (um servidor gigante recebe mensagem → milhares de clientes leem a mesma partição no mesmo instante). O inimigo recorrente é **tail latency (p99) com dados quentes**.
- **Stack:** tempo real em **Elixir/BEAM** (~20 serviços); API histórica em **Python** (monólito); **Rust** onde a latência importa (Read States, serviço de *coalescing* que junta requisições idênticas e bate no banco uma vez); armazenamento **MongoDB → Cassandra → ScyllaDB**; frontend **React/Redux**; desktop **Electron**; voz **SFU customizado (WebRTC + Opus)**.
- **Lição:** toda a arquitetura é uma resposta ao p99. GC do Go ruim → Rust. Cassandra imprevisível na compactação → ScyllaDB. Sempre a mesma luta vista de ângulos diferentes.

### 10.2 Blitz / Porofessor / Mobalytics — peso no cliente

- **Forma do problema:** *oposta* ao Discord. Cliente-pesado que lê dados de terceiros (API da Riot, LCU, Live Client Data) e desenha overlay sem atrapalhar o jogo. Backend serve **leitura stateless e cacheável**.
- **Stack:** overlay em web tech (historicamente Overwolf/Chromium); integração local leve mas crítica; backend de leitura em **Go** (aqui o Go é herói — sem heap quente pra varrer); **Python** no crunch de partidas e ML/coaching; **Redis/CDN** na frente; **rate-limiter distribuído** pro limite da Riot.
- **Lição:** **esqueça BEAM, SFU de voz, ScyllaDB.** Não há fan-out stateful. O mesmo Go reprovado no Discord é aprovado aqui — a melhor ilustração de "melhor tecnologia" só faz sentido com "…pra qual problema".

### 10.3 Premade — produto de voz (o caso que amarra tudo)

**Proposta:** monitora o jogo, detecta automaticamente os 5 aliados e disponibiliza uma voice call entre eles. Continua sendo *só* o grupo de voz (sem incorporar o Blitz inteiro), com uma camada de negócio pequena (conta + billing premium).

**Stack base:** Tauri (Rust + TS) no cliente, Go no backend custom, LiveKit/coturn pra voz, Redis + Postgres.

**Exercício de redução de linguagens** (de 3 → 2 → "TS-pesado"):

- **Piso é 2 linguagens** com Tauri. TS é travado pela UI (webview); Rust é travado pelo Tauri (overlay, WebRTC, APIs locais); **Go é o removível** (backend não exige Go, exige *uma* linguagem de backend — e já tem Rust na casa).
- **Opção 1 — Rust + TS + Go (atual):** cada linguagem no seu default fácil; mais velocidade de backend, uma linguagem a mais.
- **Opção 2 — Rust + TS (recomendada):** backend migra pra Rust. Não adiciona linguagem, *remove* uma; ganha tipos/lógica compartilhados e toolchain único. Paga em CRUD mais verboso (localizado e pequeno, porque o backend é minúsculo). `axum`/`actix-web`, `sqlx`, cliente Redis, `async-stripe`.
- **Opção 3 — TS só (mínimo absoluto):** exige largar Tauri por Electron; sacrifica a performance do overlay, que era o motivo do Tauri existir.
- **Variante "TS-pesado, Rust só no inevitável":** backend Node/TS (coordenação I/O-bound + Redis, identidade CRUD, billing Stripe, RSO/OAuth — tudo viável em TS, 80%+). Mas o **microfone/WebRTC pelo webview do sistema é a parede grande** — loteria por plataforma (Windows ok, macOS capenga, Linux o mais fraco). Pra um produto de voz, isso força o **Rust a ser dono do engine de áudio** — a peça mais crítica, ironicamente. As paredes menores (cert self-signed da LCU; detecção de processo) saem por plugin Tauri com pouco ou nenhum Rust custom.

**Por que Java/Kotlin *não* entra aqui:** o workload (coordenação pequena stateful + identidade trivial) não ativa nenhuma das forças da JVM — é **dominado** por Elixir (real-time) e Go (simplicidade). Só entraria por **time** (já é shop Kotlin) ou **futuro** (virar plataforma com moderação/T&S e big data).

---

## 11. Glossário rápido

- **Throughput:** operações por segundo (taxa, sistema inteiro).
- **Latência:** tempo de uma operação (requisição individual).
- **pN / percentil:** N% das requisições foram ≤ esse tempo. p50 = típico; p99 = cauda (a dor).
- **Tail latency (latência de cauda):** o comportamento do 1% (ou 0,1%) pior. Em escala, vira a experiência típica.
- **Hot partition:** partição de dados que muitos clientes leem ao mesmo tempo → fonte de cauda.
- **Coalescing:** intermediário que junta requisições idênticas e bate no banco uma vez só.
- **GC determinístico × estatístico:** sem coletor (Rust/RAII) libera em pontos conhecidos (garantia absoluta); com coletor (JVM/Go/V8) é probabilístico, precisa acompanhar a alocação.
- **Type erasure:** tipos do TS somem em runtime — não validam dado externo.
- **Full-stack isomórfico:** mesma linguagem (TS) e tipos compartilhados entre cliente e servidor.
- **BEAM:** a VM do Erlang/Elixir — milhões de processos isolados + supervisão (tolerância a falha).
- **SFU:** servidor que encaminha mídia (voz/vídeo) em WebRTC pra muitos participantes.

---

*Documento vivo — atualize conforme novas propostas forem cruzadas contra este mapa.*
