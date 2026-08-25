# ADR 005 - Recuperação de VOD via CDN: escopo restrito a arquivamento pessoal

## Status
Aceito

## Contexto
O daemon grava lives ao vivo, mas nem toda stream é capturada (daemon
offline no momento, gravação falha, etc.). Pra essas streams perdidas,
queremos poder recuperar o VOD depois — usando só dados que o próprio
daemon já persistiu (`channelName`, `streamId`, `startedAt`) de toda
stream que o Monitor já viu ao vivo.

O caminho oficial da Twitch (descoberta via GQL + `PlaybackAccessToken` +
usher) funciona quando o VOD está publicado normalmente, mas **não
funciona quando o streamer desabilitou o armazenamento de VOD** — a Twitch
simplesmente não lista nada (`archiveVideo: null`, `videos(): []`), mesmo
horas depois do início da live. Confirmado empiricamente contra um canal
real (`princessmariaaaaa`, ver
[apps/daemon/spikes/FINDINGS.md §5-6](../../apps/daemon/spikes/FINDINGS.md)).
Esse é exatamente o caso que motivou esta funcionalidade: uma stream que o
Monitor detectou ao vivo, mas que o daemon não conseguiu gravar (e que a
Twitch também não vai reoferecer depois).

Existe uma técnica conhecida pela comunidade (TwitchRecover, VodRecovery)
que reconstrói o path de armazenamento na CDN diretamente a partir desses
mesmos três dados (`sha1(f"{channelName}_{streamId}_{startedAt_unix}")`),
sem precisar de `vodId` nem de token algum. Confirmada empiricamente —
inclusive recuperando, de ponta a ponta, a transmissão completa (~4h14min)
de uma streamer cujo canal tinha VOD storage desligado (ver
[FINDINGS.md §6](../../apps/daemon/spikes/FINDINGS.md)). Só que essa
técnica **contorna deliberadamente** o controle de acesso que a
Twitch/streamer configurou de propósito — desabilitar VOD storage é uma
escolha explícita do streamer de não reter transmissões passadas.

## Opções consideradas

### Só o caminho oficial (A + C)
- Prós: zero ambiguidade — só recupera o que a Twitch/streamer já
  disponibiliza abertamente; nenhum risco de controvérsia.
- Contras: deixa sem solução exatamente o caso que originou esta
  funcionalidade. Uma stream detectada ao vivo pelo Monitor, não gravada
  por falha do daemon, num canal com VOD storage desligado, fica perdida
  pra sempre — mesmo que os bytes ainda existam na CDN da Twitch por um
  tempo.

### Caminho via CDN, sem restrição de escopo declarada
- Prós: maximiza a capacidade de recuperação.
- Contras: nenhuma fronteira formalizada. Se o projeto crescer (outros
  usuários, mais canais, escala), corre o risco de virar uma ferramenta
  de scraping genérica sem que ninguém tenha decidido conscientemente que
  esse era o objetivo.

### Caminho via CDN, com escopo explicitamente restrito a arquivamento pessoal
- Prós: recupera exatamente o caso que a primeira opção deixa quebrado,
  mantendo uma fronteira explícita e revisitável, amarrada à justificativa
  real (arquivar streams que o próprio daemon já detectou ao vivo), não
  uma capacidade aberta de descoberta de VOD de terceiros.
- Contras: ainda é, na prática, uma zona cinzenta de ToS — a restrição de
  escopo é uma questão de intenção declarada e documentada, não uma
  imposição técnica. Depende de disciplina contínua sobre como a
  capacidade é usada, não de um controle que impeça uso fora do escopo.

## Decisão
Implementar os dois caminhos — oficial (A/C) como primeira tentativa,
caindo pro caminho via CDN (B) só quando o oficial não resolve (ver
`DownloadVodUseCase`) — com a recuperação via CDN restrita, por decisão
consciente, a uso de **arquivamento pessoal**: recuperar streams que o
próprio daemon já detectou ao vivo, não uma ferramenta de descoberta
genérica de VODs de canais quaisquer.

## Consequências
- Orquestração implementada de forma a sempre preferir o caminho que não
  contorna controle de acesso: o caminho via CDN só é tentado quando o
  oficial genuinamente não resolve (sem `vodId`, VOD deletada/sub-only,
  ou storage desligado no canal).
- Não-requisito explícito mantido no design: o app não recupera VODs de
  canais que o daemon nunca monitorou — só tem `streamId`/`startedAt`
  confiáveis dos canais que ele mesmo acompanhou ao vivo, não é serviço de
  descoberta genérico (ver
  [docs/design/002-download-de-vods.md](../design/002-download-de-vods.md)).
- A técnica é best-effort, não garantida — não desenhada como rede de
  segurança permanente, é tentativa oportunista contra um pool de hosts
  conhecidos (ver ADR-adjacent: harvesting orgânico de hosts, seção
  "Fatiado" do design doc).
- **Se o escopo do projeto crescer** (outros usuários, escala,
  distribuição pra terceiros), esta decisão precisa ser revisitada
  conscientemente antes de prosseguir — não deve ser tratada como
  aprovação permanente e irrestrita da técnica.
