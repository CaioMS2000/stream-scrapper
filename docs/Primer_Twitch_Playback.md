# Primer — como playback da Twitch funciona (o modelo mental)

> **Natureza deste doc:** é uma *aula*, não uma referência de consulta. Enquanto o `Referencia_Tecnica_Twitch.md` guarda os fatos concretos (valores, URLs, comandos) e o `Modulo_Twitch.md` descreve o *design* do módulo, este aqui explica **o modelo mental** — o "por que o código faz o que faz". Leia antes dos outros dois se a comunicação com a Twitch ainda parece caixa-preta.
>
> Ancorado no primeiro spike (`index.ts`): baixar um VOD público.

---

## 1. Client-ID identifica um *app*, não uma conta

A confusão mais comum. São **duas camadas diferentes**:

- **Client-ID = qual *aplicativo* está chamando** (identidade do app). É o crachá de "qual programa fala comigo".
- **OAuth token / cookies = qual *usuário* está logado** (autenticação da pessoa).

O valor `kimne78kx3ncx6brgo4mv6wki5h1ko` é o **Client-ID público do próprio site da Twitch** — o que o `twitch.tv` usa dentro do navegador. Está hardcoded no JS do site, é conhecimento público, e todo mundo (streamlink, yt-dlp, este projeto) reusa ele pra fazer requisições **anônimas**, como se fosse o próprio site pedindo. **Não** é segredo, **não** é seu, **não** está atrelado a nenhuma conta.

**Resposta à pergunta "preciso do id de uma conta válida pra falar com a Twitch?": não.** Pra conteúdo **público** (VOD público, live pública) basta o Client-ID (dizer "sou um app"). Conta/usuário só entra pra conteúdo **restrito** (sub-only pelo acesso legítimo = caminho 1), e aí via `cookies.txt`, não via Client-ID.

Por que a Twitch exige *algum* Client-ID? Rate-limit e tracking. Usar o público do web = anônimo, mas válido.

---

## 2. As duas "portas" da Twitch

| | **Helix** | **GraphQL (gql)** |
|---|---|---|
| o que é | API oficial, documentada (dev.twitch.tv) | API **privada** interna que o site usa |
| registro | exige registrar um app (client_id + secret) | nenhum — reusa o Client-ID público do web |
| pra quê | detecção/metadata (o `monitor` usaria) | **pegar o token de playback** (o spike) |
| estabilidade | estável | frágil (muda sem aviso) |

O spike usa a porta **gql** (a privada) porque é ela que entrega o token pra assistir/baixar vídeo. Helix não dá isso. Essa separação é a "separação de fragilidade" do `Modulo_Monitor.md` §3: Helix (estável) pra detectar, gql (frágil) confinada só no playback.

---

## 3. Vídeo na Twitch é HLS (playlist + pedaços)

Vídeo de streaming **não é um arquivo só**. É **HLS**: um arquivo de texto (`.m3u8`, a "playlist") que aponta pra centenas de pedacinhos (`.ts`, ~2–10s cada) na CDN. Dois níveis:

- **Master playlist** = o cardápio de qualidades (1080p, 720p…), cada uma apontando pra…
- **Media playlist** = a lista ordenada dos segmentos `.ts` daquela qualidade.

Um player (ou o ffmpeg) lê a playlist, baixa os segmentos em ordem e toca/junta. YouTube/Netflix usam a mesma ideia. **O ffmpeg entende `.m3u8` nativamente** — por isso o código entrega a URL do manifesto pra ele e ele faz o resto (baixa segmentos + muxa pro `.mp4`).

---

## 4. A "dança do token" (o fluxo de verdade)

A Twitch **não te dá a URL do vídeo direto**. Você precisa provar que pode assistir. Três saltos:

```
  seu código                    Twitch
  ──────────                    ──────
  1. gql: "quero tocar o VOD X" ──────►  gql.twitch.tv
                                ◄──────  { value, signature }   ← o "token de playback"
                                          (value = JSON assinado do que você pode ver;
                                           signature = assinatura da Twitch por cima)

  2. usher: "aqui o token" ──────────►  usher.ttvnw.net  (servidor de manifesto)
                                ◄──────  master.m3u8  (o cardápio de qualidades)

  3. ffmpeg baixa os segmentos ──────►  CDN (cloudfront…)
                                ◄──────  segment_0001.ts, 0002.ts, …  → junta em .mp4
```

Resumo: **gql (pega token) → usher (troca token por manifesto) → CDN (baixa segmentos)**. O token é a catraca; o usher é a bilheteria que valida; a CDN é onde os pedaços moram.

> Detalhe do caminho 2 (recovery por hash, `Modulo_Twitch.md` §4B): ele **pula o salto 1 inteiro** — reconstrói a URL da CDN direto por `SHA1(login_streamId_startedAt)`, sem token nenhum. É por isso que funciona pra sub-only/deletado: o arquivo no bucket não checa inscrição; a catraca só existe no player.

---

## 5. Mapa do spike (`index.ts`) nesse fluxo

- `CLIENT_ID` — o crachá do app (o web público).
- `getVodToken` — **salto 1**: POST no gql pedindo o `PlaybackAccessToken`, recebe `{ value, signature }`. Truque: manda a **query inteira** em texto em vez do "persisted hash" volátil → não depende do hash que expira (`Modulo_Twitch.md` §6, `Referencia_Tecnica_Twitch.md` §4).
- `usherUrl` — monta o **salto 2**, colando `token` + `sig` na URL do usher.
- `fetch(master)` — busca o manifesto e imprime as primeiras linhas pra *ver* que veio HLS válido.
- `Bun.spawn([FFMPEG, "-i", master, …])` — **salto 3**: ffmpeg pega o manifesto, baixa os segmentos e muxa pro `.mp4`. Não se escreve o download de segmento à mão porque, **pra VOD**, o ffmpeg dá conta.

---

## 6. Por que VOD é o spike *fácil* (VOD vs Live)

O `isVod: true` é o que torna isso simples. A tabela-chave do `Modulo_Twitch.md` §4A:

| | **VOD** | **Live** |
|---|---|---|
| playlist | **fechada** (`#EXT-X-ENDLIST`, todos os segmentos já existem) | **rolante** (atualiza a cada ~2–4s) |
| token | **um só basta** | **expira no meio** de stream longa |
| ffmpeg cru | funciona lindo | **morre** quando o token vence |
| módulo | `downloader` | `recorder` (precisa streamlink/puller) |

Começar por VOD = mesmo fluxo de token, sem token expirando nem playlist mutante. Quando você fizer o spike da **live**, vai sentir na pele por que o `recorder` é mais difícil que o `downloader` — e o `Modulo_Recorder.md` §3 (decisão do motor de captura) deixa de ser teoria.

---

*Primer — o modelo mental por trás do `twitch`. Depois disso, `Modulo_Twitch.md` (design) e `Referencia_Tecnica_Twitch.md` (fatos) fazem muito mais sentido.*
