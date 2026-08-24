# Spikes

Scripts de validação empírica contra a API real da Twitch — não fazem parte
do daemon, não são chamados por nenhum código de produção. Existem pra
registrar, de forma repetível, exatamente qual chamada HTTP foi feita e o
que a Twitch respondeu, no momento em que foi testado (GQL não é
documentado oficialmente, muda sem aviso — o resultado de hoje pode não
valer amanhã).

Cada script testa uma hipótese específica levantada em
[docs/design/002-download-de-vods.md](../../../docs/design/002-download-de-vods.md).
Resultados (o que foi confirmado, refutado, ou ficou inconclusivo) vivem em
[FINDINGS.md](./FINDINGS.md), com a data do teste — é isso que depois
atualiza os pontos marcados como "precisa validação empírica" no design doc.

`curl` puro de propósito, sem depender do runtime do projeto — o objetivo é
a chamada ficar auditável por qualquer pessoa lendo o script, não testar
código do daemon.
