# Plano de Implementação (MVP em Go)

## 1. Escolha da Stack (Go)

**Linguagem:** Go 1.21+ (com suporte a módulos).

**Bibliotecas principais:**

| Biblioteca | Finalidade |
|------------|------------|
| `net/http` (stdlib) | Requisições HTTP (cliente) |
| `encoding/json` (stdlib) | Parse de JSON (API Twitch) |
| `database/sql` + `modernc.org/sqlite` | SQLite (driver puro Go, sem CGO) |
| `github.com/grafov/m3u8` | Parse de arquivos `.m3u8` (HLS) |
| `golang.org/x/sync/errgroup` | Paralelismo de downloads (goroutines com gerenciamento de erros) |
| `github.com/spf13/cobra` | CLI (comandos e flags) |
| `github.com/fsnotify/fsnotify` | (Opcional) Monitoramento de arquivos para automação |

**Motivação:** Go tem excelente suporte a concorrência (goroutines), compila para um único binário (fácil de distribuir), e tem uma stdlib robusta para HTTP. Além disso, o driver SQLite puro (`modernc.org/sqlite`) evita dependência de CGO, facilitando a compilação cruzada.

---

## 2. Estrutura de Pastas do Projeto

```text
twitch-recorder/
├── go.mod
├── go.sum
├── Makefile                 # Comandos úteis (build, test, run)
├── README.md                # Instruções rápidas
├── cmd/
│   └── twitch-recorder/     # Ponto de entrada principal
│       └── main.go
├── internal/                # Código privado do pacote
│   ├── config/              # Carregamento de configuração (JSON/YAML)
│   ├── database/            # Operações com SQLite (CRUD de streamers e sessões)
│   ├── twitch/              # Cliente para API Helix e GraphQL
│   ├── downloader/          # Lógica de download de VODs (públicos e via hash)
│   ├── recorder/            # Gravação ao vivo (loop de segmentos)
│   ├── monitor/             # Monitoramento de streamers (polling)
│   └── utils/               # Funções auxiliares (hash SHA1, FFmpeg wrapper)
├── pkg/                     # (Opcional) Pacotes reutilizáveis (ex: m3u8 personalizado)
├── data/                    # (criado em tempo de execução)
│   ├── index.db             # SQLite
│   ├── segments/            # Segmentos .ts organizados por streamer/stream_id
│   └── videos/              # .mp4 finais
├── scripts/                 # Scripts auxiliares (ex: para testes)
└── configs/                 # Configuração padrão (ex: config.yaml)
```

---

## 3. Marcos de Desenvolvimento (Entregas Incrementais)

### M1 – Download de VOD Público

**Objetivo:** Um comando que baixa qualquer VOD público da Twitch dado o `vodID`.

**Tarefas:**

1.  Criar o pacote `twitch` com:
    - Função `GetPlaybackAccessToken(vodID string) (token, sig string, error)` que faz a requisição GraphQL.
    - Função `GetVODManifest(vodID, token, sig string) (masterPlaylist string, error)` que consulta o usher e retorna o m3u8 mestre.
2.  Criar o pacote `downloader` com:
    - Função `DownloadSegments(playlistURL string, outputDir string, concurrency int) error` que baixa todos os segmentos `.ts` em paralelo.
    - Função `RemuxToMP4(segmentDir, outputPath string) error` que chama o FFmpeg via `os/exec`.
3.  Criar o comando CLI `download vod --vod-id 1234567890 --output ./video.mp4` que orquestra as etapas.

**Comportamento esperado:**
- O comando baixa o VOD e gera um arquivo `.mp4` funcional.
- Se o VOD for sub-only, a requisição GraphQL retorna `forbidden` – isso será tratado nos marcos seguintes.

---

### M2 – Download de VOD via CDN Direta (Hash)

**Objetivo:** Baixar VODs ocultos/deletados/sub-only usando o padrão de hash da CDN, desde que o `stream_id` e `timestamp` sejam fornecidos.

**Tarefas:**

1.  Adicionar ao pacote `utils` a função `BuildVODURL(streamer, streamID, timestamp string) string` que:
    - Calcula `SHA1(streamer + "_" + streamID + "_" + timestamp)`.
    - Retorna `https://vod-secure.twitch.tv/{hash[:20]}_{streamer}_{streamID}_{timestamp}/chunked/index-dvr.m3u8`.
2.  Estender o comando `download` para aceitar flags `--streamer`, `--stream-id`, `--timestamp`.
3.  Implementar a lógica de fallback: primeiro tenta a CDN direta; se não funcionar (status 404/403), tenta o método público (M1).

**Comportamento esperado:**
- Com `stream_id` e `timestamp` corretos, o comando baixa o VOD mesmo que ele não esteja listado.
- Se o VOD já tiver sido apagado da CDN (janela de ~60 dias expirada), o comando retorna erro.

---

### M3 – Monitoramento de Streamers (Polling)

**Objetivo:** Um serviço (daemon) que verifica periodicamente se os streamers configurados estão ao vivo e guarda metadados no banco.

**Tarefas:**

1.  Criar o pacote `database` com:
    - Tabelas `streamers` e `sessions` (conforme esquema definido).
    - Funções `AddStreamer(login string)`, `ListStreamers()`, `GetStreamerByLogin(login)`.
    - Funções `CreateSession(streamerID, streamID, startedAt)`, `UpdateSessionEnd(streamID, endedAt)`.
2.  Criar o pacote `monitor` com:
    - Função `CheckStreamer(login string) (isLive bool, streamID string, startedAt int64, title string, error)` que consulta a API Helix.
3.  Criar o comando `daemon start` que:
    - Carrega a lista de streamers do banco.
    - Em um loop (ex: a cada 3 minutos), chama `CheckStreamer` para cada um.
    - Se um streamer estiver ao vivo e não houver uma sessão ativa no banco, cria uma nova sessão.
    - Se um streamer que estava ao vivo sair do ar, atualiza `ended_at` da sessão.

**Comportamento esperado:**
- O daemon roda em background (pode ser executado com `nohup` ou como um serviço systemd, mas para MVP, apenas em primeiro plano com `Ctrl+C` para parar).
- As sessões são registradas no SQLite com `stream_id` e `started_at`.

---

### M4 – Gravação ao Vivo (Recorder)

**Objetivo:** Quando um streamer monitorado entra ao vivo, o sistema começa a baixar os segmentos automaticamente.

**Tarefas:**

1.  Criar o pacote `recorder` com:
    - Função `StartRecording(streamer, streamID, startedAt string) error` que:
        - Obtém o `PlaybackAccessToken` para a live (usando `login`).
        - Monta a URL do usher para live: `https://usher.ttvnw.net/api/channel/hls/{streamer}.m3u8?token=...`.
        - Baixa o m3u8 mestre e escolhe a qualidade.
        - Entra em um loop que, a cada ~2-4 segundos:
            - Baixa o m3u8 da qualidade escolhida.
            - Identifica novos segmentos (comparando com a lista já baixada).
            - Baixa os novos segmentos em paralelo.
            - Salva na pasta `data/segments/{streamer}/{stream_id}/`.
2.  Integrar com o monitor: quando o monitor detecta uma nova live, ele chama `StartRecording` em uma goroutine separada.
3.  Adicionar lógica de resiliência: se o download de um segmento falhar, tentar novamente (com backoff). Se o m3u8 não for atualizado por mais de 30 segundos, considerar a live encerrada.

**Comportamento esperado:**
- Enquanto a live estiver ativa, os segmentos são baixados continuamente.
- O sistema suporta interrupções: se reiniciar, ele deve verificar o estado da sessão e, se a live ainda estiver ativa, retomar o download (usando o último segmento baixado como referência).

---

### M5 – Pós-processamento (Remux com FFmpeg)

**Objetivo:** Quando uma live termina, automaticamente juntar todos os segmentos em um único `.mp4`.

**Tarefas:**

1.  No pacote `recorder`, após detectar que a live terminou (m3u8 não é mais atualizado), chamar a função `RemuxToMP4`.
2.  Atualizar a sessão no banco com `status = 'finished'` e `output_path = caminho_do_mp4`.
3.  Opcional: deletar os segmentos `.ts` após o remux para economizar espaço (configurável).

**Comportamento esperado:**
- Após o término da live, o sistema gera um `.mp4` na pasta `data/videos/{streamer}/{stream_id}.mp4`.
- O usuário pode acessar o vídeo imediatamente.

---

### M6 – CLI Completa e Integração

**Objetivo:** Oferecer todos os comandos planejados e integrar as funcionalidades.

**Comandos a implementar:**

```bash
# Gerenciar streamers
twitch-recorder add <streamer>           # Adiciona à lista de monitorados
twitch-recorder remove <streamer>        # Remove da lista
twitch-recorder list                     # Lista todos os streamers monitorados

# Controle do daemon
twitch-recorder daemon start             # Inicia o monitoramento + gravação
twitch-recorder daemon stop              # Para o daemon (se implementado com sinal)
twitch-recorder daemon status            # Mostra status (opcional)

# Download de VODs
twitch-recorder download vod --vod-id <id> [--output <path>]
twitch-recorder download recover --streamer <login> --stream-id <id> --timestamp <unix> [--output <path>]

# Consultar sessões gravadas
twitch-recorder sessions list            # Lista todas as sessões no banco
twitch-recorder sessions info --id <id>  # Mostra detalhes de uma sessão
```

**Tarefas:**

1.  Usar a biblioteca `cobra` para estruturar os comandos.
2.  Cada comando deve carregar a configuração (`config.yaml` ou variáveis de ambiente).
3.  Garantir que o banco de dados seja inicializado automaticamente (cria tabelas se não existirem).

---

## 4. Configuração do Ambiente

**1. Inicializar o módulo Go:**

```bash
go mod init github.com/seu-usuario/twitch-recorder
```

**2. Instalar dependências:**

```bash
go get -u modernc.org/sqlite
go get -u github.com/grafov/m3u8
go get -u github.com/spf13/cobra
go get -u golang.org/x/sync/errgroup
```

**3. Estrutura inicial de arquivos:**

- `cmd/twitch-recorder/main.go` – ponto de entrada.
- `internal/config/config.go` – carrega configuração.
- `internal/database/db.go` – inicializa SQLite e cria tabelas.

**4. Arquivo de configuração (ex: `config.yaml`):**

```yaml
data_dir: ./data
poll_interval: 3m         # 3 minutos
download_concurrency: 20  # segmentos em paralelo
quality: best             # best, 1080p, 720p, etc.
ffmpeg_path: ffmpeg       # ou caminho absoluto
retention_days: 7         # manter segmentos por 7 dias
```

---

## 5. Observações Técnicas Importantes (para não esquecer)

1.  **Acesso a VODs sub-only via CDN direta:** Não requer autenticação, apenas o `stream_id` e `timestamp`. Guarde esses metadados sempre que monitorar uma live.
2.  **Fallback para GraphQL:** Se o VOD estiver público e listado, use o método M1 (mais simples).
3.  **Sites de terceiros (TwitchTracker, etc.):** Implemente um módulo de scraping (ou use APIs, se existirem) para obter `stream_id` e `timestamp` de transmissões antigas que você não monitorou.
4.  **Mudanças na Twitch:** A persisted query hash pode mudar. Mantenha um arquivo de configuração com o hash atualizado ou, melhor, extraia-o dinamicamente do site (via scraping ou inspeção).
5.  **FFmpeg:** O sistema deve verificar se o FFmpeg está instalado na primeira execução e dar um erro amigável se não estiver.
6.  **Resiliência:** Use `defer` para fechar conexões, gravar logs e garantir que o banco seja atualizado mesmo em caso de erro.

---

## 6. Recursos de Referência

- **yt-dlp (extrator Twitch):** [https://github.com/yt-dlp/yt-dlp/blob/master/yt\_dlp/extractor/twitch.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitch.py) – referência para lógica de token e parsing.
- **TwitchRecover (Go):** [https://github.com/TwitchRecover/TwitchRecover](https://github.com/TwitchRecover/TwitchRecover) – embora seja em Java/C#, a lógica de hash é a mesma.
- **Documentação da API Helix:** [https://dev.twitch.tv/docs/api/reference](https://dev.twitch.tv/docs/api/reference)
- **Pacote m3u8 para Go:** [https://github.com/grafov/m3u8](https://github.com/grafov/m3u8)
