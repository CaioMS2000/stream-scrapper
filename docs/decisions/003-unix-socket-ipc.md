# ADR 003 - Unix domain socket para IPC daemon↔CLI, em vez de HTTP

## Status
Aceito

## Contexto
O daemon é um processo long-running que precisa receber comandos (`add-channel`,
`enable-auto-recording`, futuros) de um CLI separado. Os dois processos sempre
rodam no mesmo host, controlados pelo mesmo usuário — não há cenário de
controle remoto cross-máquina no escopo do projeto. É necessário: baixa
latência por comando, N clientes CLI concorrentes conseguindo falar com o
daemon, e um jeito simples de garantir que só o dono do processo consegue
mandar comandos.

## Opções consideradas

### HTTP (com `Bun.serve()`)
- Prós: protocolo universalmente conhecido, ferramentas de debug abundantes
  (curl, browser), caminho natural se algum dia precisar expor controle
  remoto.
- Contras: exige escolher e ocupar uma porta TCP (risco de colisão, precisa
  de config), autenticação/autorização vira problema à parte pra resolver
  (quem pode chamar o endpoint), overhead de HTTP framing desnecessário pro
  volume de comandos de um CLI local.

### Unix domain socket + NDJSON framing
- Prós: latência de request ~microssegundos, sem porta ocupada, autenticação
  "de graça" via permissão do filesystem (dono do arquivo de socket = quem
  pode conectar), NDJSON (um JSON por linha) é trivialmente depurável com
  `nc` ou lendo o arquivo, suporta N clientes concorrentes nativamente (um
  listener, múltiplas conexões).
- Contras: impossível falar com o daemon de outra máquina — cross-host fica
  fora de alcance sem trocar o transporte depois.

## Decisão
Unix domain socket com framing NDJSON, protocolo tipado como discriminated
union do zod em `@repo/ipc` (`packages/ipc/src/protocol.ts`), compartilhado
entre daemon e CLI.

## Consequências
- CLI e daemon sempre precisam rodar no mesmo host — decisão que amarra a
  arquitetura a controle local. Se algum dia for necessário controle remoto
  (ex.: gerenciar o daemon de outra máquina), isso exige um ADR novo que
  supersede este, trocando o transporte (ex.: HTTP sobre uma VPN, ou um proxy
  que reexponha o socket).
- Autenticação e autorização não precisaram de implementação própria — a
  permissão Unix do arquivo de socket já resolve "quem pode mandar comando".
- O protocolo (`IpcRequest`/`IpcResponse`) é a fonte única de verdade tipada
  entre os dois processos — mudar um comando é uma mudança em
  `packages/ipc`, refletida em compile-time nos dois lados (`@/` no daemon,
  `@repo/ipc` no CLI).
- `resolveSocketPath()` resolve o caminho do socket via `XDG_RUNTIME_DIR` com
  override por env — decisão derivada que evita hardcode de path.
