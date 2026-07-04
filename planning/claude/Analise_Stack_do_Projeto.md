# Análise de stack — VOD Archiver (registro de decisão)

> Registra as análises de opções de stack **para este projeto especificamente**. É o *porquê* por trás da decisão de linguagem — mantido **separado do design** (que é language-agnostic) e **separado do framework geral** (`Mapa_Stack_vs_Problema.md`, que é a régua universal). Complementa a entrada de uma linha do índice (§7/§8), destrinchando o raciocínio.
>
> **Natureza deste doc:** é um trade study reversível, não uma trava. O design continua agnóstico; isto documenta o raciocínio pra que a decisão possa ser revisitada com contexto.

---

## 1. Contexto e critério

**O projeto:** ferramenta local, single-user, MVP. I/O-bound (esperar rede, orquestrar ffmpeg), pesado delegado a binário nativo, **sem p99 sagrado, sem heap quente, sem fan-out**. A UI é um webview → **TS por física** (não é escolha).

**O critério que o dono fixou:** *mínimo de peças móveis* + a UI já sendo React/TS. Isso importa porque, como o mapa geral insiste, **o critério decide, não a linguagem** — mude o critério e muda o vencedor.

---

## 2. Decomposição do workload (a base de toda a análise)

| Camada | Natureza |
|---|---|
| descoberta/orquestração (`monitor`, `downloader`, `api`) | I/O-bound (muita requisição esperando rede) |
| download | I/O paralelo + **ffmpeg** (mux delegado) |
| assistir ao vivo | **decode delegado** ao player/pipeline nativo |
| pool do `recorder` | concorrência de **workers de longa duração** |
| `twitch` | **integração frágil** (lógica de referência em Python) |

**Insight que governa tudo:** nenhuma peça ativa uma parede *dura* de nenhuma candidata, porque o trabalho pesado é sempre delegado a binário nativo. Logo a **performance da linguagem quase não importa**, e a decisão "cai" pros eixos moles: ecossistema, fusão, ergonomia, distribuição e expertise.

---

## 3. Candidatos (vantagens × fricções para **este** projeto)

### 3.1 all-TS (Node motor + React UI) — a escolha do MVP

**Por que foi escolhido (a cadeia de eliminação):** a UI é TS por física → qualquer backend não-TS é uma **segunda** linguagem → o backend não exige linguagem específica (I/O-bound, pesado delegado) → a pergunta vira "vale trazer uma 2ª linguagem?" → pro MVP local, não. **Escolhido por eliminar a 2ª linguagem, não por mérito de backend.**

- **Vantagens:** fusão full-stack — uma linguagem só, tipos compartilhados front↔back (a vantagem que nenhum concorrente tem); ecossistema com afinidade natural a HLS/streaming/WebRTC; `child_process` trivial pro ffmpeg; distribuição leve; baixo atrito de código.
- **Fricções:** *type erasure* em runtime (precisa de Zod na fronteira pro gql frágil); concorrência de thread única no pool do `recorder` (viável — é I/O-bound —, mas menos elegante); ecossistema de referência é Python (porte manual da lógica do `twitch`); rigor opcional (`any`/`as`).

### 3.2 Java / Kotlin (JVM)

Constrói tudo sem drama (nada ativa parede).

- **Vantagens:** se a pessoa **só domina Java, é a melhor escolha** (eixo expertise puro); concorrência madura pro pool — threads reais, virtual threads/Loom deixam "uma thread bloqueante por gravação" legível; `ProcessBuilder` robusto pra supervisionar ffmpeg; **tipagem que valida em runtime** (não sofre type erasure — vantagem real no `twitch` frágil); ecossistema sólido pro CRUD.
- **Fricções:** ecossistema de referência é Python (porta streamlink/yt-dlp à mão — a maior); a UI fica em TS de qualquer jeito → **não fecha o full-stack**, acaba com 2 linguagens; footprint/startup da JVM pra binário pessoal (ergonomia, não performance); cerimônia/verbosidade (Kotlin corta boa parte, mesma JVM — a versão afiada).

### 3.3 Go

Constrói sem drama; é o **herói do formato I/O-bound concorrente**.

- **Vantagens:** goroutines tornam a orquestração concorrente e o pool do `recorder` triviais e legíveis (sem async/await, sem thread pool manual); **binário estático único** (distribuição impecável); footprint previsível; ideal pro cenário "frota" desde o dia 1.
- **Fricções:** é uma 2ª linguagem (some no cenário sem-restrição, mas pesa no critério de mínimo de peças); a UI continua TS (não fecha full-stack); ecossistema de referência Python (porte manual).
- **Papel especial:** no cenário ideal-sem-restrição, é o vencedor do backend (§5).

### 3.4 Python

- **Vantagens:** é a **linguagem dos projetos de referência** (streamlink/yt-dlp) → dá pra usar como lib ou portar com menos atrito; ecossistema pra eventual crunch/ML; ergonomia de script/glue I/O.
- **Fricções:** 2ª linguagem; UI em TS; distribuição mais fraca (interpretador/venv vs binário único); concorrência com asyncio funciona mas é menos limpa que goroutine pra baixar milhares de segmentos em paralelo; GIL pra CPU-bound (irrelevante no MVP).
- **Papel real:** candidato natural a **isolar só o módulo `twitch`** (a integração frágil, que a comunidade patcha em Python) no cenário poliglota — não o backend inteiro.

### 3.5 Rust

- Capaz, mas **over-engineering** pra cola + CRUD; reprova em "simplicidade" antes de qualquer outro critério. Só entraria se já houvesse comprometimento com Rust no cliente — que era o caso do Premade (webview de captura), **não** deste projeto (é daemon, não app com captura no webview).

---

## 4. Comparação direta (all-TS × Java/Kotlin × Go)

| Eixo | all-TS | Java/Kotlin | Go |
|---|---|---|---|
| Fusão de linguagem (UI+back) | ✅ uma só | ❌ vira 2 | ❌ vira 2 |
| Concorrência dos workers | ok (thread única) | ✅ confortável (Loom) | ✅ confortável (goroutines) |
| Validação da integração frágil | ❌ type erasure (Zod) | ✅ runtime real | ~ ok |
| Distribuição / leveza | ✅ leve | ❌ JVM pesa | ✅✅ binário único |
| Expertise | vence p/ quem sabe TS | vence p/ quem sabe Java | vence p/ quem sabe Go |
| Porte da lógica de referência (Python) | à mão | à mão | à mão |
| Adequação ao critério "mínimo de peças" | ✅✅ ataca direto | ❌ | ❌ |

Repara que **all-TS e Java são espelhos**: o TS ganha na fusão e perde na validação/concorrência; o Java ganha na validação/concorrência e perde na fusão. O Go fica no meio, com distribuição imbatível, mas herda a mesma penalidade de "2ª linguagem" no critério que domina aqui.

---

## 5. O cenário ideal (sem limite de recursos)

**"Ideal pra tudo" não existe** — nem com recursos infinitos. As peças têm naturezas irreconciliáveis; recurso infinito não colapsa isso num vencedor único, ele **remove a pressão de comprometer**. O resultado ideal é **poliglota por camada**, não uma linguagem:

- **UI:** TS (física — fixo em qualquer cenário).
- **Backend / orquestração / pool de workers:** **Go** (o herói do formato I/O-bound concorrente; goroutines + binário único).
- **Integração frágil (`twitch`):** Python opcional, isolado, pela facilidade de manutenção da parte que mais quebra.
- **Crunch pesado (se um dia houver):** Python (libs nativas) ou Rust pro CPU-crítico.

**Se forçar uma linguagem única de backend no ideal → Go.** Ele perdeu no caso real só por ser "2ª linguagem" sob o critério de mínimo de peças; tira esse critério e a razão da derrota some.

A simetria que fecha: mesmo sem restrição, **a UI continua TS e o crunch continuaria Python/Rust**. Recurso infinito não te deu uma linguagem — te deu a liberdade de não comprometer, e o fruto dessa liberdade é poliglota.

---

## 6. A decisão registrada

**MVP: all-TS (Node motor + React UI). Reversível a Go** se virar "frota de gravação".

- Sob o critério *mínimo de peças móveis + UI já sendo TS*, o all-TS vence porque **ataca diretamente esse critério**; suas fricções (concorrência de thread única, type erasure) são reais mas **não decisivas** num MVP local single-user.
- Se o critério dominante mudasse, o vencedor mudaria: *conforto máximo nos workers de longa duração* → Java/Kotlin; *melhor encaixe técnico do backend ignorando o custo da 2ª linguagem* → Go.
- O **design permanece language-agnostic**; esta análise é o "porquê", não uma trava. A troca Node→Go é uma reescrita do daemon contra o mesmo contrato — "uma tarde, não um recomeço".

---

## 7. Meta-lição

A tese-mãe do mapa geral, aplicada aqui: **não há stack "melhor", há melhor pra qual critério.** all-TS e o poliglota-com-Go respondem *perguntas diferentes* — "menor número de peças móveis" vs "melhor ferramenta por peça, ignorando o custo de ter várias". Nenhuma está errada; cada uma é a resposta certa pra sua função-objetivo. A escolha do projeto foi a primeira; o registro acima garante que, se a pergunta mudar, a resposta possa ser reavaliada com o raciocínio inteiro na mesa.

---

*Registro de decisão de stack — vivo. Atualize se o critério dominante mudar (ex.: o projeto começar a caminhar pra "frota") ou se uma nova candidata entrar na mesa.*
