# Módulo `store` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha a **fundação de persistência**: o módulo que possui o banco (SQLite) e o disco (a árvore de arquivos). Todos os outros módulos leem e escrevem através dele. Ainda **language-agnostic**.

---

## 1. Papel e princípio

O `store` é a única fonte da verdade sobre "o que existe e onde está". O `monitor` escreve `streams`, o `recorder`/`downloader` escrevem `recordings`/`downloads` + arquivos, a `api` lê tudo. Ninguém mais toca em SQL nem monta caminho de disco — tudo passa por aqui.

É o módulo que torna **real** a promessa da arquitetura: o layout em disco sobrevive a qualquer reescrita do motor. E é o que torna **concreta** a troca Node→Go — porque o schema e o layout (as partes caras de mudar) ficam isolados aqui; reescrever o motor é reimplementar o `store` contra o mesmo schema e o mesmo disco, e o acervo existente fica imediatamente legível.

---

## 2. Por que um módulo dedicado (e não "chamar SQLite direto")

Se cada módulo escrevesse SQL e montasse caminhos, o schema e o layout ficariam **espalhados** pelo código — uma mudança de schema tocaria tudo, quebrando exatamente o objetivo de "schema é a parte cara, isolada". Centralizar no `store` faz com schema + layout viverem **num lugar só**. É a mesma filosofia de isolamento do `twitch_config.json` (que confina a volatilidade); aqui se confina a persistência.

---

## 3. As duas faces

O `store` tem duas faces que ficam distintas por dentro, mas unificadas na API:

- **O índice (SQLite, `archive.db`):** metadata, status, relações. Consultas rápidas; a fonte da verdade pra "o que eu tenho / o que é recuperável".
- **Os blobs (filesystem):** os `.mp4`/`.ts` de verdade, na árvore de pastas, cada pasta com um `meta.json` auto-descritivo.

Quem chama não pensa nessa divisão — pede "cria uma gravação" e o `store` reserva o caminho no disco *e* insere a linha no banco, mantendo os dois em sincronia.

---

## 4. A inversão de prioridade (o que torna o `store` robusto)

**O disco é a verdade; o banco é só um índice rápido por cima dele.**

Cada pasta de stream carrega um `meta.json` completo (stream_id, user_id, login, started_at, title, game, e quais arquivos existem + a origem de cada um). Isso significa que o `archive.db` é **reconstruível**: se ele corromper, o `store` varre a árvore, lê os `meta.json` e reindexar tudo (`reindexFromDisk`).

Essa inversão é a âncora de resiliência: você nunca perde o acervo por um problema de banco. Os arquivos + `meta.json` bastam pra recriar o índice inteiro. Trata o banco como cache, não como cofre.

---

## 5. Interface pública (language-agnostic)

Agrupada por entidade. O retorno do resolver (passo 1) está marcado.

```
-- Streamers
addStreamer(login, opts)        -> Streamer
removeStreamer(login)           -> void
listStreamers()                 -> Streamer[]
getStreamer(login)              -> Streamer | null
updateStreamer(login, patch)    -> void

-- Streams
upsertStream(streamMeta)        -> Stream          -- monitor chama no go-live
getStream(streamId)             -> Stream | null
listStreams(filter)             -> Stream[]
updateStreamCdnStatus(id, status, probedAt) -> void
markStreamEnded(id, duration)   -> void

-- Recordings (caminho 3)
createRecording(streamId, quality) -> Recording    -- reserva path + insere linha
updateRecording(id, patch)      -> void            -- status, bytes, endedAt
findRecordingByStream(streamId) -> Recording | null  ★ usado pelo resolver (passo 1)
listRecordings(filter)          -> Recording[]

-- Downloads (caminhos 1 e 2)
createDownload(streamId, source) -> Download
updateDownload(id, patch)       -> void            -- status, progress
listDownloads(filter)           -> Download[]

-- Arquivos / paths
reserveStoragePath(streamId, kind) -> path         -- calcula + cria a pasta, devolve o caminho
writeMeta(streamId, meta)       -> void            -- escreve meta.json
resolveFile(streamId, kind)     -> path | null

-- Config / segredos
getConfig() / setConfig(patch)
getCookies() / setCookies(raw)                     -- cookies.txt

-- Manutenção
reindexFromDisk()               -> void            -- reconstrói o índice a partir dos meta.json
availableSpace()                -> bytes
```

O `findRecordingByStream` é o gancho que o resolver (seção 5 do spec do `twitch`) chama no passo 1 — "já tenho isso gravado ao vivo?". É a única razão de o resolver tocar o `store`.

---

## 6. Cálculo de path (centralizado)

O `store` é o **único** lugar que conhece o layout:

```
<storage_root>/<login>/<stream_id>_<started_at>/{meta.json, recording.mp4, vod.mp4, segments/}
```

`reserveStoragePath(streamId, kind)` busca a stream (login, started_at), monta o caminho, faz `mkdir -p` e devolve o path do arquivo. Ninguém concatena path fora daqui.

**Detalhe `login` vs `user_id`:** a pasta usa o **login no momento da captura** (humano-navegável — você acha os arquivos), enquanto o `meta.json` guarda o **`user_id`** (estável) pra reconciliação. Se o streamer se renomear depois, as pastas antigas continuam coerentes (eram quem ele era então) e o `user_id` no `meta.json` mantém o vínculo.

---

## 7. Consistência e concorrência

**Sincronia arquivo↔linha.** Escrever uma gravação = um arquivo no disco + uma linha no banco; um crash entre os dois pode dessincronizar. O `store` lida:
- arquivo sem linha (órfão) → o `reindexFromDisk` adota.
- linha sem arquivo (falha/parcial) → o status reflete.
- O `meta.json` + reindex reconciliam. Escritas que mudam várias linhas juntas vão numa transação.

**Concorrência.** Vários escritores assíncronos (pool do `recorder`, `monitor`, `api`) sobre um `archive.db` único. SQLite em modo **WAL** permite leitura concorrente enquanto escreve (a `api` lê enquanto o `recorder` grava). As escritas são serializadas pelo `store` (conexão única ou pool pequeno) — trivial nessa escala, single-user. Last-write-wins é aceitável.

---

## 8. Config e segredos

- **Config no banco** (uma tabela key-value): fonte única, transacional. Mais simples que sincronizar um `config.json` à parte.
- **`cookies.txt` como arquivo** (formato Netscape, importado/exportado do navegador) — faz sentido ser arquivo porque é a forma como entra e sai. **É sensível** (é a sua sessão da Twitch): o `store` nunca loga o conteúdo, mantém local e fora de versionamento. É o caminho 1 inteiro dependendo de um arquivo que precisa de cuidado.

---

## 9. O que fica adiado

- **Framework de migrations.** Eventualmente o schema evolui; no MVP, uma tabela `schema_version` + migrações manuais bastam. Vale registrar que vai ser preciso.
- **Políticas de retenção/limpeza** (apagar gravações mais velhas que X, alertas de disco cheio proativos).
- **Reindex/repair avançado** além do básico.
- **Multi-disco / storage externo.**

---

*Spec do módulo `store` — versão inicial. É a fundação: disco como verdade, banco como índice reconstruível. Com ele, a cadeia headless fecha — `monitor` → `twitch` → `recorder`/`downloader` → `store` no disco.*
