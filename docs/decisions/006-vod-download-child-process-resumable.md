# ADR 006 - Download de VOD como child process, retomável entre boots

## Status
Aceito

## Contexto
A primeira versão do `VodDownloader` (ver [doc de design 002](../design/002-download-de-vods.md),
seção D) rodava inteiramente dentro do processo do daemon: `fetch()`
assíncrono por segment, sem child process nenhum. Isso funcionava, mas
tinha uma consequência que só ficou incômoda na prática: se o daemon
reiniciasse (deploy, crash, `kill`) no meio de um download longo, todo o
progresso — inclusive os bytes já escritos em disco — ficava órfão. A
linha `download` continuava com status `downloading` pra sempre, sem
nenhum mecanismo de limpeza ou retomada, e o `TODO` correspondente ficou
registrado em `main.ts` até esta decisão resolvê-lo.

Diferente da gravação ao vivo (onde perder uma gravação em andamento é
uma perda real, mas o streamlink já é supervisionado como child process
e sobrevive a esse cenário via re-tentativa da própria stream ao vivo), um
download de VOD é a stream **inteira já disponível de uma vez** — não tem
"ao vivo" pra perder, só tempo de rede gasto de novo. Isso torna a
retomada não só possível, mas de baixo risco: o mesmo VOD, resolvido uma
vez (`host`/`baseUrl`/`segments`), pode ser rebaixado a partir de onde
parou sem re-negociar nada com a Twitch.

## Opções consideradas

### Continuar in-process, sem mudança
- Prós: zero mudança de desenho, já funcionava para o caso feliz.
- Contras: não resolve o problema — todo restart do daemon perde
  progresso de downloads em andamento, sem exceção. Pra VODs longos (horas
  de stream), isso é retrabalho de rede significativo e recorrente.

### Worker thread in-process com checkpoint periódico
- Prós: evita o custo de um processo do SO por download; ainda dentro do
  mesmo runtime Bun.
- Contras: um crash do processo do daemon (não só um erro tratável) ainda
  mata a worker thread junto — não sobrevive a exatamente o cenário que
  motivou a mudança (`kill -9`, OOM, deploy). Não ganha isolamento de
  falha real, só ganha paralelismo.

### Child process supervisionado, cursor durável no banco, resume só no boot
- Prós: sobrevive a qualquer forma de morte do processo pai, inclusive
  `kill -9` — o child continua escrevendo em disco independente do daemon
  estar vivo, e o daemon reconstrói o estado a partir do banco no próximo
  boot. Mesmo padrão já validado por [ADR 004](004-streamlink-subprocess.md)
  (streamlink) — não introduz um paradigma novo no projeto, estende um já
  aceito pra um segundo tipo de subprocess.
- Contras: mais partes móveis que os `fetch()` diretos de antes — protocolo
  de mensagens entre pai e filho, cursor persistido, lógica de truncar
  arquivo no resume. Todas mitigadas (ver "Decisão" abaixo).

## Decisão
`HttpVodDownloader` passa a ser um **despachante central**: spawna um
child process "burro" por download (`Bun.spawn`, rodando código próprio
via `infrastructure/vod-executor/executor-entrypoint.ts` — não um binário
de terceiros como o streamlink, mas o mesmo padrão de supervisão). Pai e
filho trocam um protocolo de 5 mensagens NDJSON pela stdin/stdout
(`infrastructure/vod-executor/protocol.ts`), reaproveitando o framing
(`encodeMessage`/`LineBuffer`) já existente em `@repo/ipc` — antes usado
só pro socket CLI↔daemon, aqui aplicado a um consumidor diferente porque é
framing genérico, não específico daquele protocolo.

Cursor durável `(segmentIndex, byteOffset)` — não só uma contagem de
segments — persistido na tabela `download` **depois** dos bytes chegarem
em disco, nunca antes: a defasagem entre disco e banco fica sempre do
lado seguro (o banco nunca aponta além do que já está fisicamente
gravado). Isso é o que torna o resume seguro por `truncate` simples: no
boot, `ResumeOrphanedDownloadsUseCase` trunca o arquivo pro `byteOffset`
confirmado (descartando qualquer cauda gravada depois do último
`progress` reportado) e respawna o executor a partir do `segmentIndex`
salvo.

Posse do download é resolvida por **parentesco de processo**: o
despachante sabe quem tem child vivo de graça, sem precisar checar PID no
SO. Um `leaseUntil` no banco (renovado a cada `progress`) existe só como
rede de segurança pro caso do daemon inteiro cair — distingue um `download`
`downloading` genuinamente órfão (lease vencido ou nunca setado) de um que
talvez ainda esteja em andamento num processo que sobreviveu de alguma
forma (lease no futuro, tratado conservadoramente: pula e loga aviso).

**Escopo explicitamente restrito**: a retomada acontece **só no boot**
(cold resume). Se um executor morrer em runtime com o daemon vivo
(crash do child, não do pai), o despachante detecta via `proc.exited` e
loga, mas não respawna sozinho — a linha fica `downloading` até o próximo
restart do daemon resolver via boot scan. Decisão consciente de manter a
primeira fatia simples; auto-respawn em runtime, detecção de "zumbi de
progresso" (lease renova mas `byteOffset` não avança) e calibragem fina do
threshold do lease ficam registrados como extensões possíveis, não
implementadas.

## Consequências
- `download` ganha colunas novas: `resolvedVia`, `host`, `baseUrl`,
  `segments` (material de resolução, persistido uma vez, imutável por
  VOD) e `segmentIndex`/`byteOffset`/`leaseUntil` (cursor + posse).
- O executor nunca toca o banco diretamente — só reporta progresso pro
  despachante via stdout. Mantém a mesma separação que `StreamRecorder`/
  streamlink já tinham: quem persiste é sempre o processo pai.
- O branch `need-material` do protocolo (re-pedido de material quando o
  executor recebe 401/403 buscando um segment) está implementado por
  completo, mas espera-se que fique **dormente** na prática: confirmado
  empiricamente que os segments de VOD (tanto via CDN quanto via caminho
  oficial) são servidos sem token/assinatura na URL — só a resolução
  inicial do master playlist exige auth. Se isso um dia se provar falso
  pra algum VOD, o lugar certo pra reagir é só esse handler no
  despachante (hoje ele reenvia o material já persistido, sem rede) —
  nada mais no desenho muda.
- Resolve o TODO que existia em `main.ts` sobre downloads órfãos no
  shutdown: `stopAll()` do despachante (mirror de
  `StreamRecorder.stopAll()`) envia SIGTERM em todos os children ativos no
  shutdown; o que não sair a tempo vira órfão de processo comum, resolvido
  pelo boot scan do próximo start — não precisa de espera graciosa porque
  o desenho de truncate+append tolera kill a qualquer momento (validado
  via smoke test manual: `SIGKILL` no meio de um download seguido de
  `ResumeOrphanedDownloadsUseCase` produziu arquivo final byte-a-byte
  idêntico a um download sem interrupção).
