# WIP: gravar uma stream

Missão atual: fechar o loop mínimo de **detectar canal ao vivo → gravar em disco
→ encerrar limpo**. Sem re-mux, sem eventos de recording no bus, sem retry.
Só provar que o Recorder real (spawn de streamlink) funciona end-to-end contra
uma live de verdade.

## Estado

Já pronto (tsc + `bun test` + boot verificados):

- Monitor detecta live/offline via GQL, publica `ChannelLiveEvent` /
  `ChannelOfflineEvent` (com `title` real) no bus
- Engine assina bus, persiste stream row, chama `recorder.recordTwitchStream`
- `StreamRecorder` real — spawna `streamlink`, ring buffer de stderr (50 linhas),
  SIGTERM + fallback SIGKILL em 10s, classifica exit em `stopped-by-us` /
  `stream-ended` / `error`
- Shutdown limpo: `monitor.stop` → `recorder.stopAll` → `ipc.close`

## Próximos passos

Testar contra live real (canal ao vivo qualquer): `bun run src/main.ts` num
terminal, adicionar canal via IPC no outro, aguardar ~30s, e ver o
`data/<canal>/<data>/<title>(<streamId>)/stream.ts` crescer. Ctrl+C deve
encerrar limpo com log `parada solicitada`.

Quando isso funcionar bem, os próximos incrementos que ficaram como TODO
são: eventos `RecordingFinished/Failed` no bus e job de re-mux MP4 (ffmpeg).
