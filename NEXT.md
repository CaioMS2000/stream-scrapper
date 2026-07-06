# NEXT — alvo atual: módulo `recorder` (depois: `monitor`)

> Companheiro do `WIP.md`. WIP = onde estamos; este = pra onde vamos agora, em detalhe tático. Spec: `planning/claude/Modulo_Recorder.md` (e `Modulo_Monitor.md` pro seguinte).

## Onde estamos

Motor headless com 3 módulos-fundação prontos e testados: **`store` + `twitch` + `downloader`**. O caminho **reativo** (baixar VOD passado — caminhos 1 e 2) está completo ponta a ponta, provado com conteúdo real via composition root.

## Próximo: `recorder` (caminho 3 — gravação ao vivo)

A única rota **proativa** e a única com **garantia** (a cópia é sua, sobrevive a deleção/sub-only/expiração). Espelho do downloader, mas sobre playlist **rolante** (o oposto: token expira no meio, `ffmpeg` cru morre → §3).

**Escopo da 1ª fatia (mínimo, disparo manual — defer o monitor):**
- Precisa **destravar o `resolveLiveManifest`** que ficou deferido no `twitch` (login → gql `isLive` → usher de canal → `Manifest`). O `live.ts` já provou a lógica.
- `class Recorder` (class-based + DI, como os outros): recebe o manifesto live resolvido + `streamId`, spawna a captura, grava `.ts`, no fim remuxa pra `.mp4`, arquiva no `store`.
- **Grava em `.ts`, remuxa no fim** (§7) — robusto a truncamento (a lição do moov atom que a gente já viu na prática).
- **Motor de captura atrás de interface** `CaptureEngine` (§3): `StreamlinkEngine` (MVP, re-auth sozinho) vs `SegmentPullerEngine` (versão limpa). Decidir qual no MVP — provavelmente streamlink.
- Store: `recordings` ops (un-defer quando o consumidor — este — chegar, igual fizemos com `downloads`).
- **Disparo manual** de um composition root (login + stream record na mão), como fizemos com o downloader. Sem monitor ainda.
- Prova: unit com `CaptureEngine` fake + store real temp; sanity real gravando alguns segundos de um canal ao vivo.

## Depois: `monitor` (o gatilho automático)

Fecha o loop headless: poll (Helix) → detecta go-live → registra a stream (`stream_id + started_at`) → dispara o `recorder` pros `auto_record`. É a automação que troca o "disparo na mão" pelo "grava sozinho os canais que sigo". Também colhe o `started_at` que habilita a recovery (caminho 2) — a "função escondida" do `Modulo_Monitor.md` §1.

## Quando o recorder fechar

→ Os 3 caminhos de aquisição estarão implementados de verdade (não só nos spikes). Reescreve este NEXT pra mirar o `monitor`.
