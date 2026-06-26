# Índice geral — VOD Archiver

> Hub de navegação dos documentos do projeto. Comece por aqui. O projeto é uma **ferramenta local e pessoal** que monitora streamers da Twitch, **grava lives** no momento em que sobem e **baixa/recupera VODs** (inclusive sub-only e deletados, dentro do possível), com um painel pra controlar e assistir. Roda como um **daemon local + UI no navegador**, sem Tauri/Electron.

---

## 1. Mapa dos documentos

| Documento | O que cobre | Quando ler |
|---|---|---|
| **`Mapa_Stack_vs_Problema.md`** | Framework de decisão "proposta × stack": eixos, régua de latência, mapa de linguagens. Meta-referência. | Pra decidir/justificar qualquer escolha de tecnologia |
| **`Arquitetura_VOD_Archiver.md`** | A espinha. Fronteira motor↔UI, contrato da API, schema, layout em disco, fluxos, **3 mecanismos de aquisição**. | Primeiro doc do projeto; é o índice técnico de tudo |
| **`Modulo_Twitch.md`** | Fala com a Twitch. Token dance (live/vod), recovery por hash CDN, auth por cookie. Os caminhos **1 e 2**. | Antes de codar a comunicação com a plataforma |
| **`Modulo_Recorder.md`** | Gravação ao vivo (caminho **3**). Decisão do motor de captura, ciclo, `.ts→.mp4`. | A menor fatia ponta a ponta; bom 1º alvo de código |
| **`Modulo_Downloader.md`** | Download de VOD pós-fato (caminhos **1 e 2** reativos). ffmpeg vs puller paralelo. | Espelho reativo do recorder |
| **`Modulo_Monitor.md`** | O gatilho proativo. Detecção via Helix, colheita de metadata, dispatch do recorder. | Onde a cadeia headless começa |
| **`Modulo_Store.md`** | Fundação de persistência. SQLite (índice) + disco (verdade). Reindex. | Todos dependem dele; base de tudo |
| **`Modulo_Api_Events.md`** | A fronteira. REST + WebSocket + proxy HLS + segurança local. | A casca que expõe o motor pra UI |
| **Painel React** | *(pendente)* o único pedaço que falta especificar. | Consome um contrato já pronto |

---

## 2. A espinha e como tudo se conecta

```
Mapa_Stack_vs_Problema          (meta-referência: por que cada escolha)
        │
Arquitetura_VOD_Archiver        (a espinha: fronteira, contrato, schema, disco)
        │
        ├── FUNDAÇÃO
        │     store              ← todos dependem; disco é a verdade, banco é índice
        │
        ├── AQUISIÇÃO (os 3 caminhos)
        │     twitch             ← tijolos: caminhos 1 (cookies) e 2 (hash CDN)
        │     recorder           ← caminho 3 (gravar ao vivo) · usa twitch + store
        │     downloader         ← caminhos 1 e 2 reativos · usa twitch + store
        │
        ├── GATILHO
        │     monitor            ← detecta live → dispara recorder · colhe metadata p/ caminho 2
        │
        ├── FRONTEIRA
        │     api + events       ← REST + WS + proxy HLS · fino, sem lógica de negócio
        │
        └── UI (pendente)
              painel React       ← consome só o contrato da fronteira
```

**Ordem de leitura recomendada:** Arquitetura → Store → Twitch → (Recorder, Downloader) → Monitor → Api/Events. O Mapa de Stack é transversal — consulte quando uma decisão de tecnologia aparecer.

---

## 3. Onde achar X (tópicos transversais)

| Procurando… | Vá em |
|---|---|
| Os 3 mecanismos de aquisição (tabela canônica) | `Arquitetura`, seção 8 |
| O resolver unificado (ordem de tentativa) | `Arquitetura` §8 + `Twitch` §5 |
| Contrato da API (rotas, eventos, proxy) | `Arquitetura`, seção 4 |
| Schema do banco | `Arquitetura`, seção 5 |
| Layout em disco | `Arquitetura` §6 + `Store` §6 |
| Por que sub-only funciona sem ser sub | `Twitch` §4B + `Arquitetura` §8 |
| Por que `cookies.txt` (e não é bypass) | `Twitch` §4C + `Arquitetura` §8 |
| Decisão Node vs Go | `Mapa_Stack` + `Recorder` §8 (o pivô de escala) |
| Segurança do servidor local | `Api_Events`, seção 7 |
| O caso de borda irrecuperável | `Arquitetura` §8 (passo 4) + `Recorder` §9 |

---

## 4. Princípios de design recorrentes (o tecido conjuntivo)

Estes atravessam vários specs. Tê-los num lugar só é o que o índice agrega:

- **"Não tem melhor, tem melhor pra qual problema."** A tese-mãe. (`Mapa_Stack` §1)
- **Delegar o pesado a binário nativo.** Decode/mux/captura vão pro ffmpeg/streamlink; seu código só orquestra. É o que faz a linguagem do motor não importar pra performance. (`Recorder`, `Downloader`, `Mapa_Stack`)
- **Trocável atrás de interface.** A linguagem do daemon (Node↔Go), o motor de captura (`CaptureEngine`), a estratégia de download (`DownloadStrategy`), a plataforma (Twitch↔Kick). Mesmo move repetido. (todos)
- **Isolar o que muda.** Volatilidade da Twitch no `twitch_config.json`; persistência no `store`; o contrato fino na `api`. Cada tipo de mudança confinado num lugar. (`Twitch` §6, `Store` §2, `Api_Events` §2)
- **Fronteira motor↔UI = a única decisão cara.** Tudo gira em manter o contrato estável e a linguagem do motor reversível. (`Arquitetura` §1, §3)
- **Reativo vs proativo.** Caminhos 1 e 2 buscam o passado agora; caminho 3 precisa estar montado antes. Define o que cada um cobre. (`Arquitetura` §8)
- **Disco é a verdade, banco é índice.** Reconstruível via `meta.json`. (`Store` §4)
- **Validar na fronteira.** Tipos de TS somem em runtime; a `api` valida explícito. (`Api_Events` §3, `Mapa_Stack`)

---

## 5. ffmpeg: veneno e virtude (o exemplo que mais se repete)

Vale destacar porque ilustra a tese-mãe dentro do próprio projeto:

- **Veneno no `recorder`:** live é playlist rolante e o token expira no meio → `ffmpeg` cru morre. (`Recorder` §3)
- **Virtude no `downloader`:** VOD é playlist fechada com um token só → `ffmpeg` cru é simples e perfeito. (`Downloader` §1, §3)

Mesma ferramenta, veredito oposto, decidido pelo formato do problema (fechado vs rolante). É o "Go vilão/herói" do mapa de linguagens, em miniatura, dentro de um módulo.

---

## 6. Sequência de construção consolidada

1. **`store`** — a fundação; nada roda sem ela.
2. **`twitch`** (caminhos 1 e 2) — a comunicação frágil, isolada cedo.
3. **`recorder`** com `StreamlinkEngine` — a menor fatia que põe um `.mp4` no disco e **prova a tese ponta a ponta**.
4. **`monitor`** (Helix) — fecha o loop headless: detecta → grava sozinho.
5. **`downloader`** com `FfmpegStrategy` — completa os caminhos reativos.
6. **`api` + `events`** — expõe o motor já funcional.
7. **Painel React** — consome o contrato.

Atacar o risco na ordem certa: o difícil (`twitch`) vem cedo; a UI (fácil, contrato pronto) vem por último.

---

## 7. Status

| Camada | Status |
|---|---|
| Framework de stack | ✅ especificado |
| Arquitetura (fronteira, contrato, schema, disco, aquisição) | ✅ especificado |
| `store`, `twitch`, `recorder`, `downloader`, `monitor`, `api`/`events` | ✅ especificados |
| Painel React (UX + consumo do contrato) | ⬜ pendente |
| Implementação (código) | ⬜ pendente |

**Decisões em aberto registradas:** linguagem do motor (all-TS no MVP, Go se virar "frota" — reversível); `EventSub WebSocket` como upgrade do polling; `ParallelSegmentStrategy` como upgrade do download; adapter de Kick atrás da interface `Platform`.

---

## 8. Glossário de decisões-chave (recall rápido)

- **Motor vs UI:** daemon local + React no browser, mesma origem. Sem Tauri/Electron.
- **Linguagem do MVP:** all-TS (Node motor + React UI). Go só se virar frota.
- **Detecção:** Helix (oficial, estável, batch). Playback: gql (surface privada, confinada).
- **Captura ao vivo:** streamlink no MVP (re-auth sozinho), puller próprio na versão limpa.
- **Download:** ffmpeg no MVP, puller paralelo no upgrade.
- **Gravar em `.ts`, remuxar pra `.mp4`** (parcial interrompido continua tocável).
- **`cookies.txt`** = substituto manual da sessão que uma extensão teria de graça (você é daemon, não extensão).
- **Rastrear por `user_id`**, não `login` (login muda).

---

*Índice vivo — atualize ao adicionar specs (o painel React é o próximo) ou ao concretizar decisões em aberto.*
