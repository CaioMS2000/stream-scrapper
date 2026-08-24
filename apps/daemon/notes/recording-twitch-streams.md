# Gravando streams da Twitch: streamlink vs ffmpeg

Contexto: o daemon precisa gravar lives que podem durar 12+ horas. A escolha da
ferramenta afeta robustez, complexidade do state e formato final.

## O problema do token de playback (e o Client-Id do monitor)

O daemon lida com duas credenciais diferentes contra a Twitch, de natureza
bem distinta:

- **`Client-Id` público do GQL** (monitor): identificador fixo do client web
  da Twitch (`kimne78kx3ncx6brgo4mv6wki5h1ko`), sem OAuth, sem expiração, sem
  renovação — não é de fato um "token" de sessão. Não interage com o
  gravador.
- **Access token do HLS playback** (gravador): assina a URL do `.m3u8` que o player
  consome. Dura poucas horas; segments podem ter janela ainda menor.

Se o token de playback expira **no meio da gravação**, o consumidor da URL passa a
receber 403 nos segments e o processo morre.

## Por que ffmpeg cru não serve

`ffmpeg -i https://twitch.hls.url/playlist.m3u8?sig=xyz output.mp4` recebe a URL uma
vez, no spawn. Não sabe re-autenticar, não sabe re-obter playlist quando o token
expira. Numa live longa **sempre** vai quebrar antes do fim.

Ffmpeg cru contra URL HLS pública só faz sentido quando:
- Stream é curto (< janela do token) — daemon grava 30-60min e encerra
- Fonte não exige URL assinada (radio pública, RTMP próprio)

Twitch, YouTube Live, Kick — todos usam URL assinada. Ferramenta errada pra vida longa.

## Por que streamlink é o certo

Streamlink foi construído exatamente pra isso. Sabe:
- Pedir novo playlist quando o atual expira
- Lidar com discontinuidades
- Re-autenticar quando um segment volta 403
- Seguir mudanças de qualidade
- Pular ads sem quebrar timeline

Ou seja, entrega um **pipe estável de bytes** com re-auth transparente. É o que
`twitchrecover`, `chat-downloader` e afins usam por baixo.

## Consequência arquitetural

Ao modelar o gravador como child process supervisionado:

- Spawn é `streamlink` (opcionalmente com pipe pra ffmpeg), **não** ffmpeg contra URL Twitch
- Daemon Node **não precisa** saber sobre HLS playback token — streamlink resolve
- Daemon Node **precisa** saber sobre o `Client-Id` GQL fixo (só o monitor,
  sem ciclo de vida pra gerenciar)
- Quando streamlink morre, cruzar com o monitor:
  - Canal ainda ao vivo → transiente (rede, token que streamlink não conseguiu renovar) → respawna
  - Canal offline → fim de live → encerra limpo

Vantagem indireta importante: **superfície de estado do daemon diminui** porque a
gestão do playback token sai da nossa mão.

## O que streamlink produz

**Um único arquivo, MPEG-TS, sem conversão nenhuma.**

Streamlink baixa cada segment do HLS conforme aparecem no playlist e **concatena
todos em cima do mesmo arquivo de saída**. Não guarda segments separados — vira
um blob único.

```sh
streamlink twitch.tv/lexi best -o lexi.ts
# resultado: um arquivo lexi.ts, não segment_001.ts, segment_002.ts, etc.
```

## Por que MPEG-TS e não MP4

- **MPEG-TS**: streaming-friendly. Cada pacote é auto-contido, se perde o começo
  ainda toca do meio. Perfeito pra "escreve enquanto chega".
- **MP4**: exige header `moov` (índice de amostras) no início ou fim. Precisa de
  passagem de mux — não dá pra empilhar bytes crus e chamar de MP4 válido.

Streamlink escreve TS porque é o único jeito de gravar em tempo real sem uma
segunda ferramenta muxando.

**Renomear pra `.mp4` não converte.** Os bytes continuam TS. Players tolerantes
(VLC, mpv, ffmpeg-based) tocam qualquer coisa; players estritos (iOS/QuickTime,
Chrome default) reclamam.

## Como sair de TS pra MP4

**Opção 1 — pipe streamlink → ffmpeg (MP4 desde o início)**

```sh
streamlink twitch.tv/lexi best -O \
  | ffmpeg -i pipe:0 -c copy -f mp4 lexi.mp4
```

Streamlink baixa/re-autentica; ffmpeg lê do stdin e faz mux progressivo. `-c copy`
é crucial — só re-embrulha, não re-codifica (quase zero CPU).

**Opção 2 — grava TS, re-embrulha depois**

```sh
streamlink twitch.tv/lexi best -o lexi.ts
# depois da live acabar:
ffmpeg -i lexi.ts -c copy lexi.mp4
```

Também sem re-encoding.

**Opção 3 — não converter, ficar com TS**

Muito player moderno toca `.ts`. Se o consumo é próprio (VLC/mpv/browser com
extensão), pode valer economizar CPU/passo.

## Recomendação pro daemon

**Opção 2 (TS durante + re-mux MP4 depois)** ganha por dois motivos:

1. **Robustez**: TS não corrompe se o processo morrer. MP4 corrompe se cair antes do
   `moov` ser escrito. Minimiza perda em crashes.
2. **Desacoplamento**: gravação e mux viram fases separadas. Gravador só "captura
   bytes". Job pós-live (também supervisionado, disparado por `stream_offline` ou
   exit code do streamlink) faz o rewrap. Mais fácil de raciocinar, mais fácil de
   retry se um passo falhar.

## Transcodificação (nota pra depois)

Se um dia precisar transcodificar (1080p → 720p, extrair áudio, etc), `-c copy` não
serve — precisa realmente re-encodar (decoder/encoder ativos, CPU custosa). Pra esse
caso, separar completamente do gravador — job dedicado, talvez com fila. Não é
prioridade agora; a maioria dos casos "arquivar a live" resolve com `-c copy`.
