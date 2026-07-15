# Recorder: primeira iteração (spawn de streamlink)

Nota curta com as decisões que ficaram no código do
[`StreamRecorder`](../src/recorder/recorder.ts). Contexto de por que streamlink
(vs ffmpeg cru) e por que gravar em `.ts` está em
[recording-twitch-streams.md](./recording-twitch-streams.md).

## `stopRequested` + exit code, não só exit code

A pergunta "essa gravação terminou bem ou deu erro?" tem uma armadilha: **o
exit code do streamlink sozinho não distingue "nós paramos" de "ele quebrou"**.
Quando mandamos SIGTERM, streamlink às vezes sai com código não-zero mesmo
tendo finalizado o arquivo direito (depende de em qual ponto do loop de fetch
ele estava).

A solução foi separar as duas fontes de informação:

- `stopRequested: boolean` no `ActiveRecording` — setado por `stopStream()`
  ANTES do SIGTERM
- Exit code — obtido em `handleExit` via `proc.exited`

A classificação combina os dois:

| `stopRequested` | `exitCode` | `ExitReason.kind` |
| :--- | :--- | :--- |
| `true`          | *(qualquer)* | `stopped-by-us`   |
| `false`         | `0`          | `stream-ended`    |
| `false`         | `≠ 0`        | `error`           |

Assim toda vez que o Monitor detecta offline e pedimos pra parar, o log sai
como parada solicitada — não como erro. Falso-positivo seria ruído em log 24/7.

## Ring buffer de stderr em vez de logar tudo

Streamlink pode ser bem verboso em stderr (info por segmento em `-l debug`,
warnings de rede, etc). Em uma live de 6h isso vira MBs de log inúteis.

O `stderrTail: string[]` guarda só as últimas ~50 linhas. Vazio ou irrelevante
em fim natural — descartado. Precioso em erro — é o único jeito de descobrir
por que quebrou (canal privado, geo-block, token que streamlink não conseguiu
renovar, plugin travado etc). Logamos essas 50 linhas apenas quando
`ExitReason.kind === 'error'`.

Trade-off: se algum dia precisarmos investigar bug intermitente em live longa,
50 linhas podem não bastar. Ajustar `STDERR_TAIL_MAX` quando o cenário
aparecer.

## SIGTERM com fallback SIGKILL

`stopStream()` envia SIGTERM. Streamlink usa isso pra fechar o `.ts` limpo
(finaliza o segmento em curso, fecha file descriptor). SIGKILL cortaria no
meio, e o `.ts` teria bytes truncados.

Mas nada garante que streamlink vai responder — pode estar travado esperando
resposta de rede. Um `setTimeout(10_000)` agendado pelo `stopStream()` manda
SIGKILL como fallback. `handleExit` cancela esse timer se o processo sair
antes.

**Não fazemos `await proc.exited` no `stopStream()`**. Isso deixa o handler
do bus (`Engine.onStreamEnded`) retornar imediatamente — segurar o handler
não ajuda ninguém e atrasa outros consumidores do mesmo evento. O ciclo de
vida do processo é fechado assincronamente por `handleExit`.

## Nada de eventos no bus (ainda)

Poderíamos publicar `RecordingFinished` e `RecordingFailed` já nesta
iteração. Ficou de fora porque **não há consumidor real esperando** — bus
sem subscriber é só ruído. Quando aparecer alguém que precise reagir a
gravação terminar (job de re-mux MP4, métrica, webhook), a gente cria as
classes de evento e substitui os `console.log` do `handleExit` por
`bus.publish(...)`.

Custo real de esperar: irrelevante. A migração é local no `handleExit` —
mudar 3 linhas de log por 3 linhas de publish + registrar as classes no
`@events/`.

## Rewrap TS → MP4 fora do Recorder

A recomendação em [recording-twitch-streams.md](./recording-twitch-streams.md)
(Opção 2: TS durante + `ffmpeg -c copy` depois) fica pra fase separada.
Motivos pra não empilhar aqui:

1. **Isolamento de falhas**: se o rewrap der ruim (disco cheio, ffmpeg
   crash), a gravação bruta em `.ts` já está salva. Retry só do rewrap sem
   perder bytes.
2. **Superfície menor**: o Recorder hoje cuida de UM child process com
   estado bem definido. Empilhar ffmpeg dentro dobra o state machine.
3. **Trigger natural**: rewrap disparado por evento (`RecordingFinished`)
   é o cliente ideal do bus — quando esse evento existir, o rewrap job vai
   ser o primeiro subscriber.

## `twitch` e `storage` continuam nos props

O `StreamRecorderProps` ainda recebe `TwitchClient` e `MediaStorage`, mas
essa iteração não usa nenhum dos dois — streamlink faz auth sozinho, e o
folder de saída é criado pelo Engine via MediaStorage antes de chamar o
recorder. Mantidos porque:

- **Preflight futuro**: verificar via `twitch.getChannel(...)` se a live
  ainda existe antes de spawnar (evita spawnar em canal offline por
  race entre Monitor e ação real)
- **Storage-related cleanup futuro**: se rewrap falhar e quisermos remover
  arquivo parcial, MediaStorage é o lugar

Se em 2-3 iterações continuarem sem uso, tirar sem cerimônia.
