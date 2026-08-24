# [ESPECULAÇÃO EARLY-GAME] Descoberta de VOD: `archiveVideo` como rota alternativa

> **AVISO**: Este documento é especulativo e descreve uma rota **alternativa**,
> não o plano principal. A abordagem principal de descoberta de VOD está em
> [docs/design/002-download-de-vods.md](../../../docs/design/002-download-de-vods.md)
> (job pós-live consultando o GQL da Twitch). O conteúdo abaixo só deve ser
> perseguido **se** a abordagem principal se mostrar inviável, pouco
> confiável, ou empiricamente mais cara do que o esperado. Nada aqui foi
> validado contra a API real — é uma hipótese registrada pra não se perder,
> não uma decisão.

## Contexto

Discutindo a descoberta do `vodId` de uma stream já registrada (ponto A.1 do
design de download), surgiu uma hipótese mais direta do que "job periódico
pós-live consultando lista de vídeos do canal": capturar o `vodId` **durante
a própria live**, no mesmo poll que o `ChannelMonitor` já faz hoje — em vez
de descobrir depois que a stream terminou.

## A hipótese

Pelo que lembro de material sobre a API GQL da Twitch (não documentada
oficialmente, schema muda sem aviso — **baixa confiança nessa memória
específica**), o campo `stream` de um usuário costuma expor um sub-campo
`archiveVideo { id }` **enquanto a live ainda está em andamento** — ou seja,
o VOD em progresso ("archive video") já tem um ID atribuído antes mesmo da
stream terminar, e a Twitch expõe esse vínculo no mesmo nó do GQL.

Se isso for verdade, a descoberta vira trivial: nosso `client.ts:36`
(`TwitchClientImpl.getChannel`) já busca `stream { id title createdAt }`
nessa exata query, usada pelo `ChannelMonitor` a cada tick. Bastaria
adicionar `archiveVideo { id }` ali:

```graphql
query($login: String!) {
  user(login: $login) {
    id
    displayName
    profileImageURL(width: 600)
    stream {
      id
      title
      createdAt
      archiveVideo { id }
    }
  }
}
```

Se o campo existir e vier preenchido, o `vodId` fica disponível **no mesmo
instante em que a stream é detectada como ao vivo** — sem job novo, sem
espera pós-live, sem consulta separada.

## Por que isso é só especulação, não o plano principal

- **Não testado.** Nunca foi feita uma chamada real contra a API pra
  confirmar que `archiveVideo` existe no schema atual, que não exige
  permissão/header adicional, e que vem preenchido de forma confiável (pode
  ser `null` nos primeiros minutos da stream, por exemplo, até a Twitch
  processar o archive).
- **Schema não documentado.** GQL da Twitch é reverse-engineered pela
  comunidade; campos aparecem/somem/mudam de nome sem changelog. Uma
  suposição de memória não é base suficiente pra desenhar em cima sem
  validar primeiro.
- **Cobre só streams gravadas a partir de agora.** Mesmo se funcionar, essa
  rota só captura `vodId` de lives que ainda vão acontecer — não ajuda a
  descobrir `vodId` de streams já finalizadas e persistidas no passado, que
  é o caso que a abordagem principal (job pós-live) também precisa cobrir.
  Ou seja, mesmo confirmada, essa rota seria um complemento pro caminho
  principal, não substituto total dele.

## Atualização (2026-08-24): campo confirmado no schema, valor ainda não

Rodei `apps/daemon/spikes/01-vod-discovery-query.sh` contra dois canais
offline (`anastasia_lexmur`, `apofigeaa`). A query com `archiveVideo { id }`
voltou **sem erro de validação de schema** (`stream: null` porque os canais
estavam offline, não porque o campo é inválido — GQL valida o schema antes
de executar, então um campo inexistente teria dado erro em vez de `data`
limpo). Ou seja: **o campo existe de fato no schema atual da Twitch.**

Ainda falta o teste decisivo: rodar contra um canal **realmente ao vivo** no
momento e ver se `archiveVideo.id` vem preenchido (ou `null` mesmo com a
stream ativa, o que enfraqueceria a hipótese). Ver
[FINDINGS.md](../spikes/FINDINGS.md#1-descoberta-de-vod-01-vod-discovery-querysh)
pra detalhes completos do teste.

## Atualização (2026-08-24): testado contra live real — `archiveVideo` veio `null`

Rodei contra `princessmariaaaaa`, confirmada ao vivo (`stream.id` e
`createdAt` vieram populados normalmente). `archiveVideo` veio `null` mesmo
assim. Ver
[FINDINGS.md §5](../spikes/FINDINGS.md#5-archivevideo-durante-live-real-01-vod-discovery-querysh-princessmariaaaaa).

**Isso enfraquece a versão forte da hipótese** ("um poll único no momento
da detecção já resolve o vodId") — pelo menos na janela testada (minutos
após o início da stream), o campo não populou. Não dá pra descartar 100%
(pode existir um delay maior até a Twitch processar o archive o suficiente
pra atribuir o campo — não testamos isso), mas o custo-benefício mudou: pra
essa rota valer a pena, precisaria de poll repetido ao longo de toda a live
(não só na detecção), o que é bem mais próximo em complexidade do job
pós-live que já é o plano principal. **Rebaixada de "promissora, só falta
testar" pra "provavelmente não vale a complexidade extra"** — não
recomendo perseguir mais essa rota a menos que surja um motivo novo.

## Atualização 2 (2026-08-24): não era timing — é por canal, e revela um sinal útil

Retestei mais tarde (>1h depois) contra `fofuriaa` (outro canal ao vivo) e
`princessmariaaaaa` de novo:

- `fofuriaa`: `archiveVideo` veio **preenchido em segundos** — a VOD já
  aparecia em `videos()` com `createdAt` a poucos segundos do início da
  stream.
- `princessmariaaaaa`: continuou `null`, **mesmo `stream.id`/`createdAt` de
  antes**, mais de uma hora depois. `videos()` continuou vazio também.

**Isso muda a interpretação.** Não é atraso de processamento — é
provavelmente uma configuração de conta (VOD storage desligado pra
`princessmariaaaaa`, habilitado pra `fofuriaa`). Isso na verdade **revive
parte do valor da hipótese**, só que de um jeito diferente do que eu
esperava: `archiveVideo` não serve como "atalho pra pular o job pós-live",
mas pode servir como **sinal antecipado de que aquele canal provavelmente
vai terminar em `vod_unavailable`** — se depois de alguns minutos de live
o campo continua `null` enquanto outro canal já populou em segundos, é
razoável já desviar a expectativa pra esse canal, sem precisar esperar o
timeout de 48h do job pós-live pra suspeitar disso. Ainda não é o plano
principal, mas é uma heurística barata de se checar — vale reconsiderar
como uma melhoria de UX/latência (não de descoberta em si) se o job
pós-live for implementado.

## Como validar, se um dia for perseguir isso

1. Adicionar `archiveVideo { id }` na query de `getChannel`/`getChannels`
   como experimento isolado (não em produção).
2. Rodar contra um canal real que esteja ao vivo no momento do teste.
3. Conferir se o campo aparece na resposta, se vem `null` ou populado, e se
   populado, se o `id` bate com o `vodId` que aparece depois em
   `twitch.tv/videos/{id}` pra aquela mesma stream.
4. Só promover pra design formal depois dessa confirmação empírica.
