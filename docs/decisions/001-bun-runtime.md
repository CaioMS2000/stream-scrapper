# ADR 001 - Bun como runtime, em vez de Node.js

## Status
Aceito

## Contexto
O daemon precisa de três capacidades nativas com frequência: spawnar e
supervisionar child processes (`streamlink` por gravação), falar SQLite sem
dependência binária externa, e rodar TypeScript no dia a dia sem um passo de
transpilação separado no loop de dev. O projeto é greenfield, sem código
legado em Node a migrar, o que abre a escolha de runtime sem custo de
migração.

## Opções consideradas

### Node.js + toolchain padrão
- Prós: ecossistema maior e mais maduro, `ts-node`/`tsx` bem estabelecidos,
  `better-sqlite3` e `execa` cobrem as mesmas necessidades.
- Contras: exige compor várias peças (`ts-node` ou build step, `jest`/`vitest`
  como test runner, `dotenv`, uma lib de child process mais ergonômica que
  `child_process` cru) — mais superfície de configuração pra manter.

### Bun
- Prós: `Bun.spawn` cobre supervisão de child process nativamente,
  `bun:sqlite` é SQLite nativo sem dependência de build binário, roda `.ts`
  direto sem transpiler separado, `bun test` já é auto-discovery de
  `*.spec.ts` sem config extra, `.env` carregado automaticamente.
- Contras: ecossistema menor pra libs não-mainstream; runtime mais novo, com
  menos anos de battle-testing em produção que o Node.

## Decisão
Bun 1.3 como runtime único do monorepo (daemon, CLI e scripts).

## Consequências
- Dev loop mais simples: sem `ts-node`, `esbuild`, `jest` ou `dotenv` como
  dependências separadas — o runtime absorve essas funções.
- `bun:sqlite` e `Bun.spawn` tornam a infraestrutura (`infrastructure/database`,
  `infrastructure/recorder`) mais fina, sem camada de abstração extra sobre o
  SO.
- Dívida assumida: dependência de uma lib externa pouco mainstream é um risco
  maior aqui do que seria com Node, por causa do ecossistema menor. Mitigação
  prática: manter a lista de dependências deliberadamente curta (zod,
  commander, drizzle) — todas com suporte Bun testado.
- `engines.node` continua declarado no `package.json` só como sinalização de
  compatibilidade mínima de sintaxe, não como runtime suportado de fato.
