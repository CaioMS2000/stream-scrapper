# ADR 002 - SQLite como persistência estruturada, em vez de Postgres

## Status
Aceito

## Contexto
O daemon é um processo **single-instance, single-node**: não há múltiplas
réplicas escrevendo no mesmo estado, nem requisito de acesso concorrente
cross-máquina. O que precisa ser persistido de forma estruturada e queryável
é o cadastro de canais monitorados e o histórico de streams gravadas — volume
baixo, sem necessidade de escala horizontal.

## Opções consideradas

### Postgres
- Prós: suporta múltiplos writers/réplicas, ecossistema maduro de migrations,
  faria sentido se o daemon algum dia virasse um serviço multi-nó.
  Bun tem `Bun.sql` nativo pra Postgres, então não exigiria `pg`/`postgres.js`.
- Contras: exige um processo de banco separado rodando (servidor, porta,
  credenciais) — overhead operacional desproporcional pra um daemon
  single-node cujo único cliente sou eu mesmo local. Nenhum dos requisitos
  atuais (write concorrente multi-nó, replicação) existe.

### SQLite
- Prós: zero servidor — o "banco" é um arquivo no filesystem. `bun:sqlite` é
  nativo no runtime, sem dependência binária externa. Modelo de concorrência
  (um só processo escrevendo) casa exatamente com a forma do daemon.
- Contras: sem escala horizontal — não serve se o daemon precisar virar
  multi-instância no futuro.

## Decisão
SQLite via `bun:sqlite`, com Drizzle ORM por cima para migrations tipadas e
query builder.

## Consequências
- Zero infraestrutura de banco pra rodar o daemon — `bun apps/daemon/src/main.ts`
  já sobe com persistência funcionando, sem passo de setup de servidor.
- O arquivo `.db` fica no mesmo `dataDir` dos artefatos de mídia, reforçando
  que tudo que o daemon precisa pra operar mora num único diretório local.
- Dívida assumida conscientemente: se o projeto algum dia precisar de
  múltiplas instâncias do daemon compartilhando estado (ex.: distribuir carga
  de monitoramento entre hosts), essa decisão precisa ser revisitada — SQLite
  não resolve write concorrente multi-processo através de rede. Não é um
  requisito hoje, então não foi otimizado prematuramente.
- Migrations ficam versionadas em `.drizzle/` no git, dando histórico
  auditável do schema — parcialmente compensa a ausência das ferramentas de
  ops que um Postgres gerenciado traria de fábrica.
