# Guia de trabalho para mudanças de software

Este documento apresenta um processo agnóstico de linguagem, framework,
plataforma e ferramenta para lidar com múltiplos problemas, planejar mudanças,
implementar com foco e construir um histórico de commits confiável.

O princípio central é:

> Registre problemas amplamente, mas implemente estreitamente.

Perceber um problema não obriga a resolvê-lo imediatamente. O objetivo é tirar
a descoberta da memória, registrá-la em um sistema confiável e continuar
trabalhando em uma unidade pequena, completa e verificável.

## 1. O fluxo de trabalho

Use este ciclo como padrão:

```text
capturar → classificar → priorizar → delimitar → implementar → verificar → commit
```

Depois do commit, escolha a próxima unidade e repita. Evite implementar muitas
frentes antes de formar um estado válido do projeto.

## 2. Capture descobertas imediatamente

Ao encontrar outro bug, melhoria, risco ou dívida técnica durante uma tarefa,
registre-o sem interromper desnecessariamente o trabalho atual. Use um issue
tracker, backlog, arquivo de notas ou outra fonte única e pesquisável.

Um registro mínimo deve conter:

```md
## Título que descreve o problema

### Contexto
Onde e em qual situação o problema foi observado.

### Impacto
O que acontece se ele não for resolvido.

### Evidência
Erro, comportamento observado, exemplo ou forma de reprodução.

### Possível direção
Uma hipótese de solução, sem tratá-la como decisão definitiva.

### Critérios de aceitação
- resultado observável esperado;
- casos relevantes que precisam funcionar;
- comportamento existente que deve ser preservado.
```

O registro não precisa conter uma solução completa. Ele precisa preservar
contexto suficiente para que uma pessoa consiga retomar a investigação sem
depender da memória de quem fez a descoberta.

## 3. Classifique antes de expandir o escopo

Classifique cada descoberta em relação ao trabalho atual:

- **Bloqueador:** impede concluir ou verificar a tarefa atual.
- **Dependência:** precisa existir antes da mudança atual.
- **Relacionado:** faz parte do mesmo comportamento e deve ser entregue junto.
- **Adjacente:** foi descoberto no mesmo local, mas possui responsabilidade
  diferente.
- **Cosmético:** melhora nomes, estilo ou organização sem ser necessário para o
  comportamento atual.
- **Investigação:** há sinais de um problema, mas faltam evidências.

Bloqueadores, dependências e partes inseparáveis do comportamento normalmente
entram no plano atual. Itens adjacentes, cosméticos e investigações devem ser
registrados e priorizados separadamente.

Proximidade no código não significa unidade de responsabilidade. Desconfie da
frase “já que estou neste arquivo”.

## 4. Priorize de forma explícita

Considere pelo menos quatro fatores:

1. **Impacto:** qual é a consequência para usuários, operação ou manutenção?
2. **Urgência:** existe prazo, incidente ou risco crescente?
3. **Confiança:** há evidências suficientes de que o problema e a solução foram
   compreendidos?
4. **Custo e risco:** qual é o esforço e quanto do sistema pode ser afetado?

Uma ordem comum é:

```text
incidentes e perda de dados
→ falhas que bloqueiam entregas
→ bugs de comportamento
→ requisitos planejados
→ dívida técnica com impacto conhecido
→ melhorias cosméticas
```

Essa ordem não é absoluta. Registre o motivo quando o contexto exigir uma
prioridade diferente.

## 5. Delimite unidades entregáveis

Transforme o trabalho em uma sequência de estados válidos. Para cada etapa,
pergunte:

- O projeto compila ou é interpretado sem erros novos?
- A aplicação consegue iniciar nos ambientes afetados?
- Os testes existentes continuam passando?
- A etapa tem valor próprio ou estabelece uma base completa e utilizável?
- É possível revertê-la sem desmontar mudanças independentes?
- Uma mensagem curta consegue explicar sua responsabilidade?

Uma etapa que não satisfaz essas condições provavelmente ainda não representa
uma unidade entregável.

Planeje preferencialmente em fatias verticais. Uma mudança de comportamento
pode exigir contrato, implementação, composição, migração, interface e testes
no mesmo passo. O limite correto não é um arquivo ou uma camada: é a menor
mudança completa e verificável.

Exemplo de sequência saudável:

```text
1. Adicionar uma abstração completa e sua implementação, ainda sem consumidores.
2. Integrá-la a um fluxo completo, atualizando consumidores e testes.
3. Expor um novo comportamento apoiado nesse fluxo.
4. Refatorar estruturas internas sem alterar o comportamento.
```

## 6. Controle o trabalho em andamento

Mantenha, sempre que possível, apenas uma unidade funcional em implementação.
As demais descobertas permanecem registradas no backlog.

O ciclo recomendado é:

```text
implementar → integrar → testar → commit
```

Evite:

```text
alterar muitas áreas → acumular estados incompletos → tentar separar depois
```

Separar mudanças posteriormente é possível, mas aumenta o risco de dependências
acidentais, arquivos parcialmente alterados e commits intermediários inválidos.

## 7. Faça commits atômicos

Um commit atômico não é necessariamente pequeno. Ele é completo e possui uma
responsabilidade coerente.

Idealmente, qualquer commit compartilhado deve:

- deixar o projeto compilável;
- permitir que a aplicação inicie;
- manter testes, análise estática e formatação passando;
- incluir todos os consumidores afetados por mudanças de contrato;
- conter testes novos ou atualizados quando houver mudança de comportamento;
- evitar alterações independentes ou oportunistas;
- poder ser revertido com consequências previsíveis.

Uma regra prática:

> O commit deve ser o menor possível, mas grande o suficiente para deixar o
> projeto funcionando.

Se um construtor passa a exigir uma dependência, por exemplo, o mesmo commit
deve atualizar todos os lugares que constroem esse objeto. Separar a mudança do
contrato de sua integração produz commits menores, mas não atômicos.

### Quando separar commits

Separe quando as mudanças:

- possuem responsabilidades distintas;
- podem ser verificadas independentemente;
- podem ser revertidas separadamente;
- mantêm estados intermediários válidos;
- não precisam obrigatoriamente ser entregues juntas.

### Quando manter mudanças juntas

Mantenha juntas quando:

- uma parte não compila sem a outra;
- um novo contrato exige atualização imediata dos consumidores;
- implementação, migração e comportamento precisam entrar simultaneamente;
- separar exigiria estados intermediários falsos ou quebrados;
- os mesmos testes demonstram uma única mudança observável.

### Perguntas antes de confirmar um commit

- O título pode descrever a mudança sem recorrer a “e também”?
- Todos os arquivos staged pertencem a essa responsabilidade?
- Há mudanças não relacionadas misturadas no mesmo arquivo?
- O commit pode ser revisado e revertido isoladamente?
- Os checks relevantes passam exatamente neste estado?

Commits temporários e incompletos podem ser úteis em uma branch pessoal. Antes
de compartilhar ou integrar a branch, reorganize-os para produzir um histórico
com estados válidos.

## 8. Escreva mensagens que expliquem intenção

O título deve resumir a mudança de forma direta. O corpo, quando necessário,
deve explicar motivação, restrições e consequências, sem apenas repetir o diff.

Um formato possível é Conventional Commits:

```text
tipo(escopo): resumo imperativo

Motivação da mudança e contexto que não são óbvios no código.
Consequências, restrições ou decisões relevantes.
```

Tipos comuns:

- `feat`: adiciona comportamento ou capacidade;
- `fix`: corrige comportamento incorreto;
- `refactor`: muda a estrutura sem mudar o comportamento esperado;
- `test`: altera somente testes;
- `docs`: altera somente documentação;
- `chore`: manutenção sem mudança funcional relevante;
- `build` ou `ci`: altera build, dependências ou automação.

O tipo deve refletir o efeito da mudança, não apenas o tipo de arquivo alterado.

## 9. Use cada forma de documentação para sua finalidade

- **Issue ou ticket:** trabalho ainda não concluído, com contexto e critérios.
- **Teste:** comportamento esperado expresso de forma executável.
- **Comentário:** motivo local e não óbvio; não deve narrar código evidente.
- **ADR:** decisão arquitetural importante, alternativas e consequências.
- **Documentação de uso:** como instalar, operar ou consumir o sistema.
- **Commit:** mudança concluída e sua motivação.
- **Pull request:** visão integrada da solução e das decisões tomadas.
- **TODO:** lembrete localizado, temporário e rastreável.

Não use comentários como substitutos de tickets, commits futuros como backlog
ou documentação extensa como substituta de testes.

## 10. Torne TODOs rastreáveis

Evite lembretes sem contexto:

```text
TODO: melhorar isso
```

Prefira um identificador pesquisável e uma ação concreta:

```text
TODO(#142): registrar tentativas de finalização para permitir retry.
```

Um bom TODO informa o que falta, por que não foi resolvido agora e onde o
trabalho é acompanhado. Se não houver issue tracker, use um identificador único
e registre o mesmo identificador no backlog do projeto.

## 11. Registre decisões arquiteturais

Use um Architecture Decision Record (ADR) quando uma escolha tiver impacto
duradouro, alternativas plausíveis ou consequências não óbvias.

Modelo mínimo:

```md
# Título da decisão

## Contexto
Qual problema exige uma decisão e quais restrições existem.

## Decisão
O que foi escolhido.

## Alternativas consideradas
Quais opções foram avaliadas e por que não foram escolhidas.

## Consequências
Benefícios, custos, riscos e trabalhos futuros decorrentes da decisão.
```

Um ADR registra por que a arquitetura tomou determinada direção. Ele não deve
ser apenas uma descrição da implementação atual.

## 12. Transforme bugs em evidência executável

Quando possível, reproduza um bug com um teste que falha antes de corrigi-lo:

```text
reproduzir → escrever teste que demonstra a falha → corrigir → verificar
```

O ticket preserva contexto e impacto. O teste preserva o comportamento esperado
e protege contra regressões. Um não substitui o outro.

Para falhas difíceis de automatizar, registre passos de reprodução, ambiente,
entradas, resultado atual e resultado esperado.

## 13. Verifique proporcionalmente ao risco

Execute as verificações relevantes para a área modificada:

- formatação;
- lint ou análise estática;
- compilação ou typecheck;
- testes unitários;
- testes de integração;
- migrações e compatibilidade de dados;
- inicialização e smoke test;
- segurança, desempenho ou observabilidade quando afetados.

Mudanças de alto risco exigem verificação mais ampla. Mudanças puramente
documentais não precisam do mesmo conjunto de checks de uma migração de dados.

Verifique o estado de cada commit, não apenas o estado final da branch, quando
os commits serão compartilhados individualmente.

## 14. Checklist para iniciar uma tarefa

```text
[ ] Entendi o problema e o resultado esperado.
[ ] Tenho evidência ou forma de reprodução.
[ ] Identifiquei dependências e consumidores afetados.
[ ] Separei descobertas adjacentes em registros próprios.
[ ] Dividi o trabalho em estados válidos e verificáveis.
[ ] Sei quais checks demonstrarão que cada etapa está correta.
```

## 15. Checklist antes de iniciar outra frente

```text
[ ] A unidade atual está implementada e integrada.
[ ] Todos os consumidores afetados foram atualizados.
[ ] Os testes e checks relevantes passam.
[ ] O commit contém uma responsabilidade coerente.
[ ] Descobertas não implementadas foram registradas.
[ ] Decisões importantes tiveram sua motivação documentada.
```

## 16. Checklist antes de compartilhar a branch

```text
[ ] Cada commit representa um estado válido do projeto.
[ ] Commits temporários foram reorganizados, combinados ou renomeados.
[ ] Não há arquivos, credenciais ou alterações locais acidentais.
[ ] As mensagens explicam intenção e motivação.
[ ] O conjunto completo atende aos critérios de aceitação.
[ ] A documentação e os testes refletem o comportamento entregue.
```

## 17. Heurísticas de decisão rápida

Quando houver dúvida, use estas perguntas:

### Devo corrigir este novo problema agora?

Só se ele bloquear, for uma dependência ou fizer parte inseparável do resultado
atual. Caso contrário, registre-o e continue.

### Estas mudanças pertencem ao mesmo commit?

Provavelmente sim se precisam ser entregues, testadas e revertidas juntas.
Provavelmente não se apenas estão próximas no código.

### Esta etapa está pequena demais?

Sim, se deixa contratos sem consumidores atualizados, testes quebrados ou uma
aplicação que não inicia.

### Esta etapa está grande demais?

Sim, se contém responsabilidades que podem ser verificadas e revertidas
independentemente.

### Quanto devo documentar?

Documente o suficiente para preservar contexto, intenção e critérios. Evite
registrar apenas fatos óbvios no código ou antecipar detalhes ainda incertos.

## Conclusão

Um bom processo não tenta resolver toda descoberta imediatamente. Ele permite
capturar tudo sem perder o foco, entregar mudanças completas em sequência e
preservar decisões para quem trabalhar no sistema depois.

O objetivo não é produzir o maior número de commits nem o menor diff possível.
É construir uma sequência compreensível de estados corretos, verificáveis e
reversíveis.
