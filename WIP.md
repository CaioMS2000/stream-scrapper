# WIP — onde estamos e o que vem a seguir

> Nota viva de trabalho (fase de implementação). Curta de propósito. Atualize conforme avança.

## Onde estamos

- **VOD público: provado ponta a ponta.** O spike (`index.ts`) fez gql (token) → usher (manifesto) → CDN → `.mp4` no disco. O risco central do projeto (a dança com a Twitch) está de-riscado, e funciona hoje — inclusive o truque de mandar a query gql inteira em vez do persisted hash volátil.
- Ainda é **script descartável**, sem módulos, sem `store`, sem arquitetura.

## Achados do primeiro run (a carregar adiante)

1. **Seleção de qualidade:** jogar o *master playlist* direto no ffmpeg pega a qualidade `DEFAULT` (720p) e ainda baixa dobrado. Conserto: parsear o master, escolher o media playlist da qualidade certa (`chunked` = source), e dar **essa** URL pro ffmpeg.
2. **Moov atom:** o `.mp4` parcial tocou porque **um** Ctrl+C faz o ffmpeg finalizar gracioso (escreve o moov). A lição "mp4 truncado não toca" vale pra interrupção **dura** (crash / kill -9 / queda de energia) — que é por que o recorder grava `.ts` e remuxa.

## Decisão de ordem (curto prazo)

Regra: **spikes primeiro (de-riscar), encapsular módulo depois (retrofit em cima de código que já roda).**

**Fazer agora:**
- [x] `parseManifest` + `selectQuality` no spike (funções puras). Conserta o achado 1. → é o miolo do `Modulo_Twitch.md` §4D, ainda solto no script. **Feito:** lista as 6 qualidades, escolhe `chunked`/source, ffmpeg baixa só ela (double-download eliminado, velocidade 8x→~40x). Aceita qualidade como 3º arg do CLI.

**Depois (ainda spike):**
- [ ] Spike da **live** — trocar `isVod`→`isLive`/`login`, usher de canal. Maior aprendizado: token que expira + playlist rolante (o porquê do `recorder`).
- [ ] Spike do **recovery por hash CDN** — `SHA1(login_streamId_startedAt)` + HEAD, sem token (o caminho 2).

**Ainda NÃO (é cedo):**
- Encapsular o **módulo downloader**. Depende do `store` (que não existe) e da interface do `twitch` (só estabiliza depois dos spikes de live+recovery). Fixar a fronteira agora = churn.

## Quando a arquitetura de verdade começa

Quando os 3 spikes fixarem o que o `twitch` precisa expor. Aí segue a sequência do `planning/claude/00_Indice_Geral.md` §6: **store → twitch → recorder → monitor → downloader → CLI → api → React.**
