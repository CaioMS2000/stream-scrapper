# Módulo `monitor` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha o módulo que é o **gatilho proativo** do motor headless: detecta quando um streamer monitorado sobe, colhe a metadata, registra e dispara o `recorder`. Ainda **language-agnostic**.

---

## 1. Papel e princípio (e a função escondida)

O `monitor` observa a lista de streamers monitorados e, quando um sobe, faz três coisas:

1. **Colhe a metadata** da stream (`stream_id`, `started_at`, `title`, `game`).
2. **Registra** em `streams`.
3. Se `auto_record` ligado, **dispara o `recorder`**.

A função óbvia é o item 3 — ele é o que torna possível o "tem que estar rodando quando a live sobe" do `recorder`. Mas a função **escondida e igualmente importante** é o item 1.

**A revelação:** o `started_at` que o monitor colhe é justamente o que alimenta o hash da CDN no caminho 2 (recovery). Ou seja, **mesmo que você não grave ao vivo**, o simples ato de o monitor registrar `stream_id + started_at` é o que te deixa recuperar aquele VOD depois pela CDN. Sem esse registro, você não tem os ingredientes do hash, e a recuperação fica impossível.

Isso explica, do lado de dentro, o comportamento da sua referência ("só pego conteúdo a partir de quando você monitora"): **duas coisas começam no instante do "monitorar"** — a colheita de metadata (habilita o caminho 2) e a gravação ao vivo (caminho 3). Nada de antes existe porque nada de antes foi colhido nem gravado.

---

## 2. Posição no fluxo

- **Depende de:** `twitch` (detecção + metadata), `store` (lê streamers monitorados, escreve `streams`), `recorder` (dispatch), `events` (emite `streamer.live`, `stream.discovered`).
- **Dispara:** o `recorder` (caminho 3).
- **Produz:** linhas em `streams` + eventos.

---

## 3. Detecção: Helix vs gql (a separação de fragilidade)

Para **detectar live + pegar metadata básica**, há duas fontes — e aqui a escolha é diferente da do resto do `twitch`:

| | Helix `Get Streams` | gql (superfície privada) |
|---|---|---|
| natureza | **API pública oficial**, documentada, estável | superfície privada, frágil |
| batch | até **100 logins por chamada** | possível, menos limpo |
| metadata | retorna `id`, `user_id`, `user_login`, `started_at`, `title`, `game_name` — **autoritativo** | idem, mas via surface instável |
| setup | exige registrar um app (client_id + client_secret, client-credentials) | anônimo, zero setup |

**Recomendação:** o `monitor` deve usar **Helix**. O batimento cardíaco do motor precisa ser estável, e a metadata do Helix (em especial o `started_at` preciso) é autoritativa — exatamente o que o hash da CDN exige. Isso cria uma **separação de fragilidade limpa**: o Helix (oficial) cuida da *detecção*; a surface privada do gql fica confinada só ao *playback* (as funções `resolve*` do `twitch`). O frágil fica isolado onde é inevitável.

O custo é um registro de app único (client_id/secret via client-credentials, sem usuário envolvido). Se você quiser zero setup no MVP, gql/`getLiveMetadata` funciona como fallback — mas a recomendação é Helix pela estabilidade e pela precisão do `started_at`.

---

## 4. O loop e a máquina de estados

Pollia o status de **todos** os monitorados a cada N segundos, em **uma chamada batch** (Helix aceita até 100 logins) — barato e amigo do rate limit. Por streamer, mantém o último estado conhecido e age só na **transição** (a borda), não a cada poll.

```
offline → live   : colhe metadata → upsert streams → emite streamer.live + stream.discovered
                   → se auto_record E não há gravação ativa desse stream_id: dispatch recorder
live    → offline: marca a stream encerrada (duração) → emite (o recorder também finaliza sozinho)
live    → live   : nada (ou atualiza title/game se mudou)
```

**Idempotência por `stream_id`:** nunca dispare um segundo `recorder` pra uma stream que já está sendo gravada. A borda offline→live só dispara se não houver handle ativo.

---

## 5. Interface pública (language-agnostic)

```
start()             -> void     -- inicia o poll loop
stop()              -> void
pollNow()           -> void     -- força um poll imediato (ex.: após adicionar streamer)
getState(login)     -> 'live' | 'offline' | 'unknown'
```

Adicionar/remover monitorados é feito pela API via `store`; o `monitor` pega na próxima volta (ou na hora, com `pollNow`).

---

## 6. Reconciliação no restart e `user_id` vs `login`

**Reconciliação:** se o app reinicia no meio de uma stream, o monitor precisa reconciliar — um streamer está live, mas há gravação ativa? Se o app esteve fora, a gravação parou. No boot, detecta "live mas sem gravação" e, se `auto_record`, inicia uma nova (será um arquivo separado). **O gap enquanto o app esteve fora é perdido** — é a limitação intrínseca da rota proativa, e o motor deve marcar isso em vez de fingir que tem a stream inteira.

**`user_id` é a chave estável, não o `login`.** Logins da Twitch **podem mudar**; o `user_id` (numérico) nunca muda. O monitor deve resolver `login → user_id` uma vez e rastrear por `user_id`, guardando ambos. Evita perder um streamer só porque ele se renomeou.

---

## 7. Concorrência (escala trivial)

Como o poll é batch (uma chamada cobre até 100 monitorados), mesmo o cenário "frota" são poucas chamadas por intervalo. O `monitor` em si é **leve** — o peso (as gravações simultâneas) mora no pool do `recorder`. Então o monitor escala de graça; ele não é o gargalo de nada.

---

## 8. Modos de falha

| Sintoma | Reação |
|---|---|
| API fora / erro de rede | loga, **pula o intervalo, tenta no próximo** — nunca derruba o loop |
| 429 (rate limit) | backoff; aumenta o intervalo temporariamente |
| go-live perdido (intervalo largo demais) | perde alguns segundos do início + `started_at` levemente impreciso → mitigado por intervalo razoável e por pegar o `started_at` **autoritativo da API**, não inferido da hora da detecção |
| app reinicia no meio | reconcilia (seção 6); o gap fora é perdido e marcado |
| streamer renomeado | rastrear por `user_id` resolve (seção 6) |

---

## 9. O que fica adiado

- **EventSub via WebSocket** (o upgrade forte): em vez de pollar, a Twitch te **empurra** um `stream.online` no instante em que o streamer sobe. O EventSub por WebSocket **não exige URL pública** (diferente do webhook), então é viável num app local — elimina o polling e o atraso de detecção. No MVP, polling é mais simples; o EventSub é a evolução natural depois.
- **Polling adaptativo** (pollar menos quem está claramente offline há horas).
- **Polling ciente de agenda** (intensificar perto dos horários habituais do streamer).

---

*Spec do módulo `monitor` — versão inicial. É o gatilho do caminho 3 e o colhedor de metadata do caminho 2: pequeno, leve, mas é onde a cadeia headless inteira começa.*
