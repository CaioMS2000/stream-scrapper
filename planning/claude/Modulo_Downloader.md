# Módulo `downloader` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha o módulo que implementa os **caminhos 1 e 2 de aquisição** (download de VOD pós-fato: acesso legítimo e bypass pela CDN). Ainda **language-agnostic**. É o espelho reativo do `recorder`.

---

## 1. Papel e princípio

O `downloader` recebe um VOD que **já existe** (publicado, ou recuperável pela CDN) e baixa os segmentos, produzindo um `vod.mp4`. A diferença crucial em relação ao `recorder`: ele trabalha sobre uma **playlist fechada** — finita, com todos os segmentos conhecidos de antemão e `#EXT-X-ENDLIST` presente. Um token só basta, não há expiração no meio.

É por isso que **aqui o `ffmpeg` cru no manifesto finalmente serve** (o que era veneno pro recorder): sem stream rolante, sem token vencendo, a simplicidade do ffmpeg vira vantagem em vez de fragilidade. Esse é o pagamento daquela nota lá no spec do `recorder`.

Princípio de design idêntico ao resto: trabalho pesado (download + mux) delegado a binário nativo; o módulo orquestra; a estratégia de download fica **atrás de uma interface**, trocável depois.

---

## 2. Posição no fluxo

- **Gatilho:** API `POST /api/streams/:id/download` (iniciado pelo usuário) ou um item de fila.
- **Depende de:** `twitch` (`resolveVodManifest` → caminho 1; `recoverVodManifest` → caminho 2), `store` (local de escrita + linha em `downloads`), `events` (progresso).
- **Produz:** `vod.mp4` + linha em `downloads` (`source` = `authenticated` | `cdn-recovery`).
- **Não é invocado pro caminho 3:** se o resolver achar uma gravação ao vivo própria, não há o que baixar — já existe. O `downloader` só entra nos caminhos 1 e 2.

---

## 3. `recorder` vs `downloader` (o contraste que fecha o loop)

| | `recorder` (caminho 3) | `downloader` (caminhos 1 e 2) |
|---|---|---|
| fonte | playlist **rolante** (live) | playlist **fechada** (VOD) |
| token | expira no meio → re-auth | um só, basta |
| timing | proativo (antes/durante) | reativo (a qualquer momento na janela) |
| motor viável | streamlink / puller (não ffmpeg cru) | **ffmpeg cru serve** / puller paralelo |
| parcial | **mantém** (irrecuperável) | **resume/refaz** (refazível) |

A última linha é a simetria importante: o `recorder` guarda o parcial porque a live não volta; o `downloader` pode descartar e refazer, porque a fonte continua lá (dentro da janela).

---

## 4. As estratégias de download

| Estratégia | Como | Prós | Contras |
|---|---|---|---|
| **A. ffmpeg no manifesto** | `ffmpeg -i media.m3u8 -c copy vod.mp4` | uma linha; concat+mux de brinde | download **sequencial** (lento em VOD longo); progresso menos granular |
| **B. puller paralelo + concat** | parseia o playlist → baixa os N segmentos em paralelo (concorrência limitada) → concatena/remuxa | **muito mais rápido**; progresso por segmento (feito/total); **resumível** | mais código |

**Recomendação MVP:** comece com **A (ffmpeg)** — caminho mais curto pra um arquivo funcional, mesma filosofia de delegar ao binário. Mas anote que, ao contrário do recorder (onde o streamlink já paraleliza), **aqui o upgrade pra B vale muito**: VODs têm milhares de segmentos, e sequencial é lento. Por isso a estratégia fica atrás da interface `DownloadStrategy`, e o `FfmpegStrategy` migra pro `ParallelSegmentStrategy` sem mexer no resto.

---

## 5. Interface pública (language-agnostic)

```
queueDownload(streamId, opts) -> DownloadHandle
cancelDownload(downloadId)     -> void
listDownloads()                -> DownloadHandle[]
```

Estratégia atrás de interface:

```
interface DownloadStrategy {
  download(manifest, quality, outputPath, callbacks) -> ProcessHandle
}
-- FfmpegStrategy (MVP) | ParallelSegmentStrategy (upgrade)
-- callbacks: onProgress(0..1), onDone(), onError(err)
```

O `manifest` vem pronto do `twitch` (caminho 1 ou 2); a estratégia não sabe nem se importa de qual veio — só consome o `Manifest` normalizado.

---

## 6. Tipos e a fila

```
DownloadHandle {
  id          : string
  streamId    : string
  source      : 'authenticated' | 'cdn-recovery'
  status      : 'queued' | 'downloading' | 'completed' | 'failed'
  progress    : float            -- 0..1
  storagePath : string
}
```

**Fila com cap de concorrência:** downloads são muitos e grandes; rodar 50 ao mesmo tempo satura banda e disco. Uma fila limitada (`queued → downloading → completed/failed`) com concorrência configurável evita isso. (E o `ParallelSegmentStrategy` tem seu *próprio* cap interno de segmentos paralelos — são dois níveis: quantos downloads simultâneos × quantos segmentos por download.)

---

## 7. Ciclo (sub-rotinas)

1. **Resolve fonte.** Recebe o `Manifest` resolvido (caminho 1 ou 2) → `selectQuality(variants, pref)` → URL do media playlist.
2. **Pega o media playlist** (fechado, com todos os segmentos + `ENDLIST`).
3. **Unmute** (se `manifest.muted`) → `unmuteMediaPlaylist` reescreve as URLs `-muted`.
4. **Baixa** via estratégia A ou B → escreve em disco.
5. **Finaliza** → `vod.mp4` (`-c copy`, sem recodificar).
6. **Progresso** → emite `download.progress` (ffmpeg: parseia `time=` vs duração total; puller: segmentos feitos/total — mais preciso).
7. **Conclusão/falha** → status + `storagePath` → emite `download.completed`/`failed`.

---

## 8. Especificidades de ffmpeg (os bits concretos)

- **Auth é no manifesto, não por segmento.** O controle de acesso (caminho 1) é aplicado no passo do usher; uma vez que o `twitch` devolveu o `Manifest`, os segmentos na CDN geralmente são fetcháveis direto. Ou seja, o `downloader` quase nunca precisa repassar cookie por segmento — o `twitch` já passou pela catraca.
- **`cdn-recovery` (caminho 2):** o `index-dvr.m3u8` reconstruído referencia segmentos relativos ao host da CDN; passe a **base URL** completa pro ffmpeg resolver.
- **Gotcha `.ts → .mp4` com AAC:** ao muxar TS pra MP4, áudio AAC costuma precisar de `-bsf:a aac_adtstoasc`, senão o mp4 sai com áudio quebrado. Detalhe pequeno que economiza horas de debug.
- **`-c copy` sempre.** Nunca recodificar no MVP — é cópia de stream, rápida e sem perda.

---

## 9. Parcial: resume vs refazer (contraste com o recorder)

Diferente do `recorder` (que **guarda** o parcial porque a live é irrecuperável), o download é **refazível** enquanto o VOD estiver na janela. Então:

- **`ParallelSegmentStrategy`:** parcial é **resumível** — ao reiniciar, pula segmentos já baixados. É o melhor dos mundos.
- **`FfmpegStrategy`:** mais simples refazer do zero (ou usar `.ts` intermediário + resume manual).

Em ambos, parcial não é tesouro a preservar; é progresso a retomar.

---

## 10. Modos de falha

| Sintoma | Causa provável | Reação |
|---|---|---|
| segmento 404 no meio | a janela da CDN fechou durante o download, ou mismatch de `-muted` | re-tenta o unmute; se sumiu de fato, `failed` com motivo claro |
| manifesto expira em VOD muito longo | token venceu (raro — token de VOD dura mais que o de live) | re-resolve via `twitch` e retoma |
| 429 | rate limit | backoff; o cap de segmentos paralelos protege (boa cidadania + evita bloqueio de IP) |
| disco cheio | — | `failed`, mantém parcial pro resume |

---

## 11. O que fica adiado

- **`ParallelSegmentStrategy`** (MVP usa ffmpeg; o upgrade vem depois, e aqui vale mais que no recorder).
- **Resume entre reinícios do app** (persistir progresso de segmentos no banco).
- **Download em lote** do histórico inteiro de VODs de um streamer.
- **Fallback de qualidade** (se a qualidade pedida não existir, cair pra mais próxima).
- **Download de clips.**

---

*Spec do módulo `downloader` — versão inicial. Com `twitch` + `recorder` + `downloader`, os três caminhos de aquisição estão completos: o motor já sabe adquirir conteúdo por qualquer rota.*
