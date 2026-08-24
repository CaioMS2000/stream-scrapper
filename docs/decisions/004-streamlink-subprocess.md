# ADR 004 - streamlink como child process, em vez de ffmpeg direto ou lib Node

## Status
Aceito

## Contexto
O daemon precisa gravar lives da Twitch que podem durar 12+ horas sem
interrupção. A URL do HLS playback (`.m3u8`) é assinada com um token de curta
duração (poucas horas, às vezes menos) — diferente do `Client-Id` público do
GQL não-documentado usado pelo monitor para polling de status, que é um
identificador fixo do client web da Twitch (não um token de sessão), sem
expiração nem renovação. Se o token de playback expira no meio de uma
gravação longa, o consumidor da URL passa a receber 403 nos segments
seguintes.

## Opções consideradas

### ffmpeg direto contra a URL HLS
- Prós: uma ferramenta só no pipeline, amplamente conhecida.
- Contras: `ffmpeg -i <url.m3u8> output.mp4` recebe a URL **uma vez**, no
  spawn — não sabe re-autenticar nem re-obter playlist quando o token de
  playback expira. Numa live de 12h, sempre quebra antes do fim. Só serviria
  se a gravação fosse mais curta que a janela do token, ou se a fonte não
  exigisse URL assinada — nenhum dos dois é o caso da Twitch.

### Biblioteca Node/Bun para consumir HLS
- Prós: manteria tudo no mesmo processo do daemon, sem child process pra
  supervisionar.
- Contras: reimplementar re-autenticação de token, tratamento de
  discontinuidade de segments e troca de qualidade é reconstruir, em código
  próprio, exatamente o que ferramentas dedicadas já resolvem — sem ganho
  real, só mais superfície de manutenção e mais estado dentro do processo
  principal do daemon.

### streamlink como subprocess
- Prós: streamlink foi construído especificamente pra este problema — pede
  playlist novo quando o token expira, lida com discontinuidades, re-autentica
  em segment 403, segue mudança de qualidade. Entrega um pipe estável de
  bytes com re-auth transparente. Rodar como child process isola falhas: se o
  streamlink travar ou morrer, o daemon continua vivo — `proc.exited` captura
  o código de saída e o daemon decide o que fazer (cruzando com o estado do
  monitor: canal ainda live → transiente, respawna; canal offline → fim de
  live, encerra limpo).
- Contras: dependência de um binário externo (Python) no PATH, fora do
  controle do runtime Bun — precisa existir no ambiente ou via
  `STREAMLINK_BIN_PATH`.

## Decisão
`streamlink` como child process supervisionado (`Bun.spawn`), gravando o
stream bruto como MPEG-TS (`.ts`) via `-o`, sem re-encoding no caminho
crítico.

## Consequências
- O daemon **não precisa saber nada sobre o token de playback HLS** — essa
  complexidade fica inteiramente dentro do streamlink. O daemon não precisa
  gerenciar nenhum ciclo de vida de token pro monitor: o polling de status usa
  GQL não-documentado com `Client-Id` público fixo, sem expiração nem
  renovação. Superfície de estado do daemon diminui por consequência direta
  desta escolha.
- Formato de saída é MPEG-TS, não MP4: streamlink concatena os segments HLS
  num único arquivo TS conforme chegam, sem passagem de mux — é o único jeito
  de gravar em tempo real sem uma segunda ferramenta escrevendo o header
  `moov` do MP4. Renomear `.ts` pra `.mp4` não converte os bytes; players
  estritos (iOS/QuickTime, Chrome default) rejeitam. Rewrap pra MP4 fica como
  job assíncrono pós-gravação (`ffmpeg -c copy`, sem re-encode) — ver seção
  "Roadmap" do README.
- Robustez a crash: TS não corrompe se o processo morrer no meio; MP4
  corromperia se caísse antes do `moov` ser escrito. Motivo direto pra manter
  gravação e mux como fases separadas em vez de gravar MP4 desde o início.
- Dependência externa (binário `streamlink` no PATH) precisa existir no
  ambiente de execução — documentado em "Pré-requisitos" no README, com
  fallback via `STREAMLINK_BIN_PATH` para instalações fora do PATH padrão.
