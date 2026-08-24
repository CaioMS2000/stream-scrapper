# Design: teto de gravações simultâneas no StreamRecorder

**Status:** proposto, não implementado. Este documento existe justamente pra
capturar o raciocínio de desenho *antes* de escrever o código — quando a
implementação acontecer, revisitar este arquivo e atualizar o Status pra
"implementado" (ou registrar um ADR se a decisão final divergir do que está
proposto aqui).

## Problema
Hoje o `StreamRecorder` não impõe limite de gravações (processos `streamlink`)
ativas simultâneas. Se muitos canais monitorados ficarem live ao mesmo tempo
(cold start do daemon com N canais já ao vivo, ou um pico real), o daemon
acumula N processos streamlink sem teto, consumindo CPU/rede/disco sem
controle.

## Requisitos e não-requisitos

**Requisitos:**
- Impor um limite configurável de gravações simultâneas (`MAX`).
- Sob o limite atingido, rejeitar novas tentativas de gravação de forma
  previsível (sem crash, sem corromper estado).
- Nunca deixar um "órfão de gravação": uma row de stream + `meta.json`
  marcados como `"recording"` que nunca finalizam porque o `streamlink`
  correspondente nunca chegou a rodar.
- Preservar o invariante já coberto por teste (`start-recording.spec.ts`):
  um `streamId` duplicado nunca deve chegar a invocar o recorder uma segunda
  vez — o DB (constraint UNIQUE) precisa continuar validando **antes** de
  qualquer spawn de processo caro.

**Não-requisitos (fora de escopo agora):**
- Distribuir o teto entre múltiplas instâncias do daemon (não existe hoje —
  ver [ADR 002](../decisions/002-sqlite-storage.md), daemon é single-node).
- Priorização entre canais quando o teto está cheio (ex.: fila com
  prioridade). A proposta atual é rejeição simples, sem fila.

## Abordagem proposta

**Checagem antecipada (Opção A do levantamento em `temp.md`):** o
`StreamRecorder` expõe `hasCapacity()`; o `StartRecordingUseCase` checa essa
condição no **topo** do `execute()`, antes de persistir qualquer coisa no DB
ou no filesystem, e retorna `failure` se o teto estiver cheio.

Esta é a abordagem mais simples das três levantadas, e a que se encaixa no
comportamento **atual** do sistema: o `ChannelMonitor` processa transições
`ChannelLiveEvent`/`ChannelOfflineEvent` publicando no bus **dentro de um
`for` sequencial** (`await bus.publish(...)` por transição, sem
`Promise.all`), e ticks do monitor não se sobrepõem
(`startMonitoring` só reagenda depois que o tick anterior termina). Ou seja,
execuções de `StartRecordingUseCase` nunca rodam concorrentes hoje — são
sempre single-flight.

Sob essa premissa, a checagem antecipada vira um **teto duro**: cada execução
só começa depois que a anterior já persistiu e já incrementou
`activeRecordings.size`, então não existe janela onde duas checagens leem o
mesmo valor "velho" simultaneamente.

**Por que não a alternativa "mais robusta" (Opção B, teto atômico dentro do
spawn):** a Opção B move a checagem `if (activeRecordings.size >= MAX)` pra
dentro de `recordTwitchStream()`, colada ao `activeRecordings.set()` sem
`await` no meio — o que a torna atômica mesmo sob concorrência real. O custo é
que isso exige **reordenar** o use case pra persistir *depois* do spawn dar
certo (senão o throw do teto deixa órfão). Esse reorder regride o invariante
de duplicata coberto pelo teste: o DB deixaria de validar antes do spawn, e um
`streamId` duplicado poderia chegar a spawnar um `streamlink` de verdade antes
do UNIQUE barrar. Pagar esse preço não se justifica **hoje**, porque o cenário
que a Opção B protege (execuções concorrentes) não acontece enquanto o monitor
for sequencial.

## Alternativas consideradas

| | A — checagem antecipada | B — atômico no spawn + reorder | C — reserva com contador paralelo |
|---|---|---|---|
| Teto sob execução sequencial (cenário atual) | duro | duro | duro |
| Teto sob execuções concorrentes (cenário hipotético) | **mole** — overshoot silencioso, sem erro | duro | duro |
| Deixa órfão de gravação | não | não | não |
| Exige reordenar o use case | não | **sim** | não |
| Regride o invariante de dup-streamId testado | não | **sim** | não |
| Risco específico | depende de o monitor continuar single-flight | inverte "validar antes de agir" | reserva pode vazar se um caminho de saída esquecer o `release` — teto encolhe silenciosamente (50→49→48…) até reiniciar |

Uma quarta opção foi descartada antes de chegar a comparação formal:
**batching** das transições do monitor (processar N por vez com
`Promise.all` em vez de sequencial). A ideia era suavizar o pico de spawns,
mas não ataca a causa: se 30 canais estão live, 30 processos streamlink vão
rodar de qualquer forma — batching só muda o instante do spawn, não a carga
sustentada. Quem resolve isso é o teto, não o batching. E manter o monitor
sequencial (não adotar batching) é exatamente a premissa que torna a Opção A
seguro — as duas decisões são acopladas.

Vale registrar o enquadramento conceitual que confirmou essa escolha: o
problema geral (produtor que se beneficiaria de paralelismo × receptor que
precisa de coerência) tem dois casos. Quando o estado é particionável por
chave (aqui, por `channelName` — gravar o canal A não toca em nada do canal
B), a técnica é paralelizar entre chaves e serializar só dentro de cada uma
(sharding-style, ou modelo de atores/mailbox). Quando existe um ponto
genuinamente compartilhado — o contador `activeRecordings.size` é exatamente
isso, um único número lido/escrito por todos — a técnica de livro-texto é um
**semáforo contável**: a seção crítica deve ser o menor pedaço possível
(check + increment), não o use case inteiro. A Opção B é essa técnica aplicada
de forma estreita (semáforo só no contador). A Opção A, no cenário sequencial
de hoje, entrega o mesmo resultado sem precisar da mecânica de semáforo,
porque a serialização já existe "de graça" — vem do próprio monitor rodar
sequencial.

## Riscos e trade-offs

- **Risco principal da Opção A:** sua corretude depende inteiramente de o
  monitor continuar single-flight. Se um dia outro gatilho de
  `StartRecordingUseCase` for introduzido fora do fluxo sequencial do monitor
  (ex.: um comando `force-record` no CLI, ou batching for reintroduzido por
  outro motivo), o teto volta a furar silenciosamente — sem erro, sem crash,
  só overshoot invisível até alguém checar `activeRecordings.size`.
- **Mitigação proposta:** documentar essa suposição explicitamente como
  comentário no código, no ponto onde `hasCapacity()` é checado — não como
  teste (não dá pra testar uma suposição sobre o *shape* do chamador), mas
  como aviso legível pra quem for adicionar um novo caminho de disparo do
  use case.
- **Trade-off aceito conscientemente:** abrir mão da robustez da Opção B
  (correta sob qualquer concorrência) em troca de simplicidade e de preservar
  o invariante de duplicata testado. Se a suposição de single-flight for
  quebrada no futuro, a migração para a Opção B (ou C) precisa vir junto da
  mudança que introduziu concorrência — não depois.

## Plano

1. Adicionar `hasCapacity()` ao `StreamRecorder`, lendo `activeRecordings.size`
   contra um `MAX` configurável (via `config`, mesmo padrão de
   `streamlinkBinPath`).
2. Checar `hasCapacity()` no topo de `StartRecordingUseCase.execute()`,
   retornando `failure` cedo — antes de `createStream()` — se o teto estiver
   cheio.
3. Cobrir com teste: teto cheio → `execute()` falha e nenhuma row/meta.json é
   criada (garante que a checagem está de fato antes de qualquer persistência).
4. Comentário no código apontando a suposição de single-flight do monitor e
   a nota "se reintroduzir concorrência aqui, migrar pra teto atômico no
   spawn (Opção B) e revisar o teste de dup-streamId".
5. Sem migração de dados nem rollout gradual necessários — é um novo caminho
   de falha (`failure`) num use case existente, não uma mudança de schema.
