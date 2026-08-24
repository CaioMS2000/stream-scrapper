# Requisitos Funcionais

## Implementados

- **RF01 — Ping**: usuário verifica que o daemon está vivo e respondendo.
- **RF02 — Adicionar canal**: usuário cadastra um canal da Twitch para ser
  monitorado pelo daemon (login, case-insensitive).
- **RF03 — Ligar auto-recording**: usuário habilita gravação automática para
  um canal já cadastrado (grava sempre que o canal entrar ao vivo).
- **RF04 — Remover canal**: usuário para de monitorar um canal (inverso do
  RF02). Bloqueado se o canal estiver com uma gravação em andamento.
- **RF05 — Desligar auto-recording**: usuário desabilita a gravação
  automática de um canal sem removê-lo do monitoramento (inverso do RF03).

## Propostos

### Gerenciamento de canal

- **RF06 — Listar canais**: usuário vê os canais monitorados e o status de
  cada um (ao vivo/offline, gravando agora, auto-record ligado/desligado).

### Controle de gravação

- **RF07 — Forçar gravação**: usuário inicia a gravação de um canal
  manualmente, mesmo sem auto-record ligado. Reusa o `StartRecordingUseCase`
  já existente — só precisa de uma entrada nova no protocolo IPC.
- **RF08 — Parar gravação**: usuário interrompe uma gravação em andamento
  manualmente.
- **RF09 — Listar gravações de um canal**: usuário vê o histórico de
  gravações (data, duração, tamanho, status `finished`/`failed`).

### Políticas (já citadas no roadmap do README, sem comando de usuário ainda)

- **RF10 — Configurar retenção por canal**: usuário define política de
  expiração (manter só as últimas N gravações ou últimos M dias).
- **RF11 — Configurar notificação por canal**: usuário registra um webhook
  (Discord/Slack) para ser avisado quando uma gravação terminar ou falhar.

## Prioridade sugerida

RF06 primeiro — fecha o trio de gerenciamento de canal junto com RF04/RF05,
já implementados. RF07–RF11 ficam para depois, alinhados ao roadmap do
README.
