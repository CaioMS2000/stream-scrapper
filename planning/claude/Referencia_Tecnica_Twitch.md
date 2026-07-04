# Referência técnica — fatos concretos da Twitch

> Companheiro do `Modulo_Twitch.md`. Enquanto o spec do `twitch` descreve o **design** (interface, tipos, o que é volátil vs congelado), este doc guarda os **fatos concretos** que a implementação precisa ter na mão: URLs, valores de hash, headers, rate limits, comandos de ffmpeg e gotchas. São **language-agnostic** — valem igual pra Node ou Go.
>
> **Aviso de volatilidade:** os itens marcados **⚠ volátil** mudam sem aviso e vivem no `twitch_config.json` (ver `Modulo_Twitch.md` §6). Os valores abaixo são o *ponto de partida*, não a verdade permanente.

---

## 1. Fontes alternativas de metadata (recuperar `stream_id` e `started_at`)

Quando você **não** monitorou a live na hora (e portanto não colheu `stream_id + started_at` — ver `Modulo_Monitor.md` §1), esses agregadores arquivam o histórico de streams de cada canal:

| Fonte | URL | Conteúdo |
|---|---|---|
| TwitchTracker | `https://twitchtracker.com/{streamer}/streams` | lista de streams passadas com `stream_id` e `start_time` |
| Streamscharts | `https://streamscharts.com/twitch/{streamer}/streams` | similar |
| SullyGnome | `https://sullygnome.com/streamer/{streamer}/streams` | histórico detalhado |

**Cuidados:** esses sites fazem scraping da própria Twitch → têm latência (atualizam a cada poucos minutos) e nem sempre capturam lives curtas (< 5 min). São **fallback pro caminho 2**, não fonte primária. A fonte primária é o seu próprio `monitor` registrando `started_at` autoritativo do Helix.

> Nota de precisão: o hash da CDN exige o `started_at` no **segundo exato**; trackers às vezes arredondam. Ver a estratégia de janela ±N segundos em `Modulo_Twitch.md` §4B.

---

## 2. Janela de retenção da CDN (limite físico do caminho 2)

- VODs ficam na CDN por cerca de **60 dias** após a live.
- Para canais **não-parceiros**, o VOD pode ser deletado automaticamente em **7 a 14 dias** (depende das configurações do streamer).
- Fora dessa janela → `recoverVodManifest` retorna `NotOnCdn`, e o resolver desiste ou cai pro caminho 1 (ver `Modulo_Twitch.md` §5).

É por isso que o `recorder` (caminho 3) é a única rota com **garantia**: a CDN é uma aposta contra o relógio de retenção.

---

## 3. Headers das requisições GraphQL

- **`Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko`** — é o ID público do cliente web da Twitch. Pode ser usado sem autenticação; não é segredo nem seu.
- **`Client-Integrity`** ⚠ volátil — algumas queries pedem esse header (um JWT gerado por script ofuscado). Para `PlaybackAccessToken` e queries básicas **geralmente não é exigido**. Se começar a dar 403, é sinal de que passou a ser necessário. Estratégia: **evitar endpoints que o exigem** (pegar metadata pelos trackers em vez do gql) — ver `Modulo_Twitch.md` §6.

---

## 4. Persisted query hash ⚠ volátil

A Twitch usa Apollo persisted queries. O hash da query `PlaybackAccessToken` **muda de tempos em tempos** — é a **rota que mais quebra** (ver `Modulo_Twitch.md` §6, tabela de modos de falha).

- Hash observado (referência de **maio/2026**): `0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712`
- **Sintoma de que mudou:** erro GQL em `PlaybackAccessToken`. Quando o playback para de funcionar de repente, é quase certo que foi isto.
- **Conserto:** inspecionar o tráfego da Twitch no DevTools, achar o hash novo, atualizar no `twitch_config.json`. Não reescrever lógica.

---

## 5. Rate limits

| Superfície | Limite | Implicação |
|---|---|---|
| Helix (`monitor`) | ~800 req/min pra token de app | folgadíssimo — você não bate. O poll batch (até 100 logins/chamada) usa quase nada. |
| Usher (pegar m3u8) | ~20 req/min por IP | cuidado: muitas chamadas → 429. Relevante no `recorder`/proxy quando re-resolve token. |
| CDN (segmentos) | sem limite agressivo | mas baixar 1000 segmentos de uma vez satura a conexão → use paralelismo **controlado** (10–20 workers). É o cap interno do `ParallelSegmentStrategy` (ver `Modulo_Downloader.md` §6). |

Reação a 429 em qualquer superfície: **backoff exponencial** + cap de concorrência (boa cidadania protege seu IP de bloqueio).

---

## 6. Comportamento do m3u8 dinâmico (live)

- O `index-dvr.m3u8` de uma **live** é atualizado a cada **~2–4 segundos** (playlist rolante, sem `#EXT-X-ENDLIST` até encerrar).
- Ele contém só os **últimos ~60 segundos** de segmentos → você **não** consegue voltar no tempo se começar a gravar depois que a live começou.
- **Corolário:** pra gravar do início, tem que estar monitorando **antes** — é a justificativa direta do polling constante do `monitor` e da natureza proativa do `recorder` (ver `Modulo_Recorder.md` §1).

Contraste com **VOD**: playlist **fechada**, com `#EXT-X-ENDLIST` e todos os segmentos conhecidos — é o que deixa o ffmpeg cru servir no `downloader` (ver `Modulo_Downloader.md` §1).

---

## 7. Comandos de ffmpeg úteis

**Juntar segmentos `.ts` num `.mp4`** (o remux final do `recorder`, `Modulo_Recorder.md` §7):

```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
```

Onde `filelist.txt` lista os segmentos na ordem correta.

**Baixar direto de um m3u8** (a `FfmpegStrategy` do `downloader`, `Modulo_Downloader.md` §4):

```bash
ffmpeg -i "https://...index-dvr.m3u8" -c copy output.mp4
```

Útil pra VOD (playlist fechada). Pra gravação **ao vivo** você quer o puller próprio (baixar segmentos manualmente) pelo controle sobre interrupções e re-auth — ver a decisão de motor de captura em `Modulo_Recorder.md` §3.

**Gotchas de mux (economizam horas de debug):**
- **`.ts → .mp4` com AAC:** costuma precisar de `-bsf:a aac_adtstoasc`, senão o mp4 sai com áudio quebrado (ver `Modulo_Downloader.md` §8).
- **`-c copy` sempre** no MVP — cópia de stream, rápida e sem perda; nunca recodificar.
- **Gravar em `.ts`, remuxar no fim** — mp4 truncado não toca (moov atom só no encerramento); `.ts` é robusto a truncamento (ver `Modulo_Recorder.md` §7).

---

## 8. Verificação de integridade de segmentos

Segmentos podem vir corrompidos (especialmente se a conexão cair). Um `.ts` válido tem o byte `0x47` na posição 0 (sync byte do MPEG-TS). Se não tiver → re-baixar com retry exponencial. Útil no `SegmentPullerEngine`/`ParallelSegmentStrategy`.

---

## 9. VODs sub-only e `cookies.txt`

- Para baixar VOD restrito a inscritos pelo **caminho 1** (acesso legítimo), você precisa de um token OAuth de uma conta que **é sub** do canal.
- Uma *extensão* herda os cookies do navegador logado automaticamente. Seu motor é **daemon, não extensão** → não herda nada. O `cookies.txt` (formato Netscape, exportável via extensão "cookies.txt" do navegador) é o **substituto manual** dessa sessão.
- O cookie carrega **identidade, não autorização** — não é bypass. O bypass real (sub-only sem ser sub) é o **caminho 2** (hash da CDN). Ver a distinção completa em `Arquitetura_VOD_Archiver.md` §8 e `Modulo_Twitch.md` §4C.
- **Sensível:** é a sua sessão da Twitch. Nunca versionar, nunca logar o conteúdo, nunca expor por endpoint (ver `Modulo_Store.md` §8 e `Modulo_Api_Events.md` §7).

---

## 10. Fallback: yt-dlp

O `yt-dlp` já implementa o fluxo de download de VODs **públicos** da Twitch e serve como fallback pros casos que sua implementação ainda não cobre:

```bash
yt-dlp https://twitch.tv/videos/{vod_id}
```

Chamável via subprocesso se o caminho próprio falhar. Também é a **referência de lógica** (token dance, parsing) mais fiel — o extrator fica em [`yt_dlp/extractor/twitch.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitch.py).

---

## 11. Recursos de referência

- **yt-dlp (extrator Twitch):** https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitch.py — lógica de token e parsing.
- **TwitchRecover:** https://github.com/TwitchRecover/TwitchRecover — a lógica de hash da CDN é a mesma; mantêm listas de hosts de CDN (útil pro `cdnHosts` volátil).
- **Documentação da API Helix:** https://dev.twitch.tv/docs/api/reference
- **Pacote m3u8 (Go):** https://github.com/grafov/m3u8 — caso o motor vá pra Go.

---

*Referência técnica — os valores ⚠ voláteis (hash, Client-Integrity, hosts de CDN) precisam de manutenção; o resto é estável. Atualize quando um valor quebrar em produção.*
