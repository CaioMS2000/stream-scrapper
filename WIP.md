# WIP — onde estamos e o que vem a seguir

> Nota viva de trabalho (fase de implementação). Curta de propósito. Atualize conforme avança.

## Onde estamos

- **Os 3 caminhos de aquisição: provados ponta a ponta**, cada um num spike descartável:
  - `index.ts` — VOD (caminho 1): gql token → usher → CDN → `.mp4`. Playlist fechada, ~40x.
  - `live.ts` — Live (caminho 3): gql live → usher canal → `.ts` rolante em tempo real (1x).
  - `recovery.ts` — Recovery (caminho 2): hash SHA1 da CDN, sem token/conta.
- O risco central (a dança frágil com a Twitch) está **de-riscado** e funciona hoje — inclusive o truque de mandar a query gql inteira em vez do persisted hash volátil.
- Ainda é **script descartável**, sem módulos, sem `store`, sem arquitetura. → **próximo passo: começar a arquitetura de verdade.**

## Achados do primeiro run (a carregar adiante)

1. **Seleção de qualidade:** jogar o *master playlist* direto no ffmpeg pega a qualidade `DEFAULT` (720p) e ainda baixa dobrado. Conserto: parsear o master, escolher o media playlist da qualidade certa (`chunked` = source), e dar **essa** URL pro ffmpeg.
2. **Moov atom:** o `.mp4` parcial tocou porque **um** Ctrl+C faz o ffmpeg finalizar gracioso (escreve o moov). A lição "mp4 truncado não toca" vale pra interrupção **dura** (crash / kill -9 / queda de energia) — que é por que o recorder grava `.ts` e remuxa.

## Decisão de ordem (curto prazo)

Regra: **spikes primeiro (de-riscar), encapsular módulo depois (retrofit em cima de código que já roda).**

**Fazer agora:**
- [x] `parseManifest` + `selectQuality` no spike (funções puras). Conserta o achado 1. → é o miolo do `Modulo_Twitch.md` §4D, ainda solto no script. **Feito:** lista as 6 qualidades, escolhe `chunked`/source, ffmpeg baixa só ela (double-download eliminado, velocidade 8x→~40x). Aceita qualidade como 3º arg do CLI.

**Depois (ainda spike):**
- [x] Spike da **live** (`live.ts`) — **Feito:** capturou source 1080p em `.ts` válido, tocável. Aprendizado-chave: `speed=1.01x` (tempo real, vs 40x do VOD) → o `recorder` é worker de longa duração, não fetch. Token não expirou (run curto ~2min); a morte por token só aparece em gravação longa.
- [x] Spike do **recovery por hash CDN** (`recovery.ts`) — **Feito:** `SHA1(login_streamId_startedAt)[:20]` + HEAD nos hosts de CDN, sem token. Validado determinístico: o hash calculado bateu com o path real do VOD (`b2fa85c40d5d5513b56a`) e a CDN deu 200. Inclui janela ±2s pro arredondamento de tracker.

**Ainda NÃO (é cedo):**
- Encapsular o **módulo downloader**. Depende do `store` (que não existe) e da interface do `twitch` (só estabiliza depois dos spikes de live+recovery). Fixar a fronteira agora = churn.

## Quando a arquitetura de verdade começa

Quando os 3 spikes fixarem o que o `twitch` precisa expor. Aí segue a sequência do `planning/claude/00_Indice_Geral.md` §6: **store → twitch → recorder → monitor → downloader → CLI → api → React.**
