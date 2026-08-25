# WIP: pipeline de download de VOD

Trabalho em andamento, dividido em 4 issues no Linear que formam um
conjunto único — cada uma alimenta a próxima. Este arquivo existe pra
retomar o trabalho mesmo numa sessão/máquina diferente, sem precisar
reconstruir o contexto do zero.

**Fonte de verdade do desenho**: [`docs/design/002-download-de-vods.md`](docs/design/002-download-de-vods.md).
Esse documento tem o raciocínio completo — premissas, riscos, decisões
tomadas e por quê. Este WIP só aponta pra lá e registra o estado de
implementação + o que falta.

**Evidência empírica**: toda a técnica (descoberta via GQL, reconstrução
via CDN) foi validada contra a Twitch real antes de virar código — ver
[`apps/daemon/spikes/FINDINGS.md`](apps/daemon/spikes/FINDINGS.md) e os
scripts em [`apps/daemon/spikes/`](apps/daemon/spikes/).

## Premissa (resumo de 1 parágrafo)

O daemon grava lives ao vivo, mas nem toda stream é capturada (daemon
offline, gravação falha, etc.). Como já persistimos `channelName` +
`streamId` + `startedAt` de toda stream que o Monitor já viu ao vivo, dá
pra recuperar o VOD depois — pelo caminho oficial da Twitch (GQL) ou, se
esse falhar, reconstruindo o path na CDN a partir desses mesmos dados
(técnica confirmada funcionando até pra canais sem nenhuma VOD listada
oficialmente).

## As 4 issues (Linear, projeto "Stream scrapper", time Caioms)

| Issue | O quê | Status | Depende de |
|---|---|---|---|
| [CAI-74](https://linear.app/caioms/issue/CAI-74) | Caminho A — descoberta oficial do `vodId` via GQL | ✅ **Feito** | — |
| [CAI-75](https://linear.app/caioms/issue/CAI-75) | Caminho C — auth (`videoPlaybackAccessToken`) + resolução de playlist oficial, com `qualityPref` | ⬜ Não iniciado | — |
| [CAI-76](https://linear.app/caioms/issue/CAI-76) | Orquestrar fallback entre caminho oficial (A/C) e recuperação via CDN (B) | ⬜ Não iniciado | CAI-74, CAI-75 |
| [CAI-77](https://linear.app/caioms/issue/CAI-77) | Harvesting automático de hosts de CDN | ⬜ Não iniciado | CAI-74, CAI-75 |

(O caminho B — recuperação via CDN — mais D/E — download + persistência —
já estavam implementados **antes** dessas 4 issues existirem; são a base
sobre a qual elas constroem. Ver seção "Fatiado — v1 implementado" no
design doc.)

## Estado atual do código

**Já implementado e testado:**

- **B (CDN) + D (download) + E (persistência)** —
  `apps/daemon/src/infrastructure/cdn-recovery/` (hash + pool de hosts +
  resolver), `apps/daemon/src/infrastructure/downloader/`
  (`HttpVodDownloader`), `DownloadVodUseCase` +
  `FinalizeDownloadUseCase`, tabela `download` ligada. Comando IPC/CLI
  `download-vod <streamId>`.
- **A (descoberta oficial)** — `apps/daemon/src/application/use-cases/link-vod.ts`
  (`LinkVodUseCase`, matching por proximidade `createdAt`×`startedAt`,
  timeout 48h) + `apps/daemon/src/infrastructure/vod-linker/`
  (`VodLinker`, scheduler periódico, 10min default, mesmo padrão de
  `setTimeout` self-rescheduling do `ChannelMonitor`). Campo
  `stream.vodLookupStatus` (`pending`/`linked`/`unavailable`). Método novo
  `TwitchClient.getChannelVideos`. Validado contra a Twitch real (VOD
  verdadeira da `apofigeaa` vinculada corretamente).

**Ainda não existe:**

- **C** — nenhum código de auth/playlist oficial. `DownloadVodUseCase` hoje
  só tenta o caminho B, mesmo quando `stream.vodId` já está preenchido
  pelo A.
- **Orquestração (CAI-76)** — não existe nenhuma lógica de "tenta C, cai
  pro B se falhar". A conversa que originou essa issue já mapeou o desenho:
  um port comum (`type VodResolverFn = (params) => Promise<Resolution | null>`,
  já é a assinatura de `resolveVod` que o `DownloadVodUseCase` recebe hoje)
  + uma função `chainResolvers(...resolvers)` que tenta cada um em ordem e
  só falha se todos falharem (mesmo padrão da `CredentialsProviderChain`
  da AWS SDK). Ver histórico da conversa ou pedir esse trecho de novo se
  precisar — não foi escrito em nenhum arquivo do repo ainda, só discutido.
- **Harvesting automático (CAI-77)** — `host-pool.ts` continua lista
  estática. Só existe o jeito manual
  (`apps/daemon/spikes/04-cdn-host-harvest.sh`).

## Como retomar

Ordem natural: **CAI-75 (C) → CAI-76 (orquestração) → CAI-77 (harvesting)**
— é a ordem de dependência que as próprias issues já têm registrada.

Pra CAI-75, o fluxo já foi validado empiricamente ponta a ponta em
`apps/daemon/spikes/03-playback-access-token.sh` (query GQL raw pro
`videoPlaybackAccessToken`, sem persisted query, funciona) — é questão de
portar isso pro mesmo formato de `infrastructure/cdn-recovery/` (um
`infrastructure/official-vod/` ou nome parecido), resolvendo a variante de
qualidade certa via `channel.qualityPref` a partir do master playlist que o
usher devolve.
