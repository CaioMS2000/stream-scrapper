# cli

CLI do stream-scrapper. Fala com o daemon via unix socket — o daemon
precisa estar rodando (`bun apps/daemon/src/main.ts`).

```bash
bun scrapper ping                            # verifica que o daemon está vivo
bun scrapper add-channel <username>          # cadastra canal pra monitorar
bun scrapper enable-auto-recording <user>    # liga gravação automática
bun scrapper disable-auto-recording <user>   # desliga gravação automática
bun scrapper remove-channel <user>           # remove canal (bloqueado se estiver gravando)
bun scrapper list-channels                   # lista canais e o status de cada um
bun scrapper start-record <user>             # força gravação (canal precisa estar ao vivo)
bun scrapper stop-record <user>              # interrompe gravação em andamento
```

Todos os comandos aceitam `--json` pra saída crua em vez do texto formatado.
