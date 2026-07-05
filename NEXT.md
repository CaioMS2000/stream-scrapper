# NEXT — alvo atual: módulo `store`

> Companheiro do `WIP.md`. WIP = onde estamos; este = **pra onde vamos agora**, em detalhe tático. Reescrito quando o alvo fecha. Spec completo e atemporal: `planning/claude/Modulo_Store.md`.

## Por que o `store` agora

Acabou a fase de spike (os 3 caminhos provados). A sequência de build (`00_Indice_Geral.md` §6) começa pelo `store`: a **fundação**. Nada persiste sem ele, e todos os outros módulos leem/escrevem através dele. É também a primeira peça de arquitetura "de verdade" (fim dos scripts descartáveis).

## A tese que a primeira fatia tem que provar

**"Disco é a verdade, banco é índice"** (`Modulo_Store.md` §4). Se isso vale, o acervo sobrevive a qualquer corrupção/perda do banco. Então a primeira fatia **não é "CRUD bonito"** — é provar isso ponta a ponta, do mesmo jeito que os spikes provaram a Twitch:

> escrever stream + arquivo + `meta.json` → **apagar o `archive.db`** → `reindexFromDisk()` reconstrói tudo.

Esse é o "spike do store": de-risca a claim central (resiliência) antes de erguer o resto. Se passar, o store está certo por construção.

## Primeira fatia (mínima, provável end-to-end)

1. **Bootstrap** — abrir/criar `archive.db` com `bun:sqlite`, ligar **WAL**, criar tabelas se não existirem. Schema da `Arquitetura_VOD_Archiver.md` §5: `streamers`, `streams`, `recordings`, `downloads` (cria as 4, usa 2 por ora).
2. **Disco** — `reserveStoragePath(streamId, kind)`: calcula `<root>/<login>/<streamId>_<startedAt>/`, faz `mkdir -p`, devolve o caminho. `writeMeta(streamId, meta)`: grava o `meta.json` auto-descritivo.
3. **Entidades mínimas** — `addStreamer`/`getStreamer`, `upsertStream`/`getStream`. (`recordings`/`downloads` ficam pra quando `twitch`/`recorder`/`downloader` precisarem.)
4. **`reindexFromDisk()`** — varre a árvore, lê os `meta.json`, reconstrói as linhas.
5. **A prova** — um script curto (ex.: `store-check.ts`) que: insere streamer + stream, reserva path, escreve `meta.json` → **apaga o `archive.db`** → `reindexFromDisk()` → confirma que voltou idêntico. É o critério de "fatia pronta".

## Como abordar

- **`bun:sqlite`** (`import { Database } from "bun:sqlite"`), WAL mode, conexão única (escritas serializadas — single-user, trivial).
- Vive em **`src/store/`** — um diretório por módulo, `index.ts` exportando as funções (o "módulo = pasta com responsabilidade + poucos pontos de troca" do índice §4). É a **primeira pasta de `src/`** do projeto.
- **`login` na pasta** (humano-navegável) + **`user_id` no `meta.json`** (estável, sobrevive a rename) — `Modulo_Store.md` §6.
- `storage_root` default `./data` por ora (vira config depois).
- A interface language-agnostic do `Modulo_Store.md` §5 é o norte — implementa só o subconjunto acima nesta fatia.

## Ainda NÃO nesta fatia (defer consciente)

- Framework de migrations (só uma `schema_version` + manual, depois).
- Ops completas de `recordings`/`downloads` (só quando o consumidor existir — evita churn).
- Retenção/limpeza, reindex avançado, multi-disco.
- Tabela de config + `cookies.txt` (entra quando o `twitch`/caminho 1 precisar).

## Quando esta fatia fechar

→ Próximo alvo: **extrair o módulo `twitch`** — recortar o token dance + `parseManifest`/`selectQuality` + recovery por hash (que hoje estão duplicados nos 3 spikes) atrás de uma interface única. Aí este `NEXT.md` é reescrito pra mirar nele.
