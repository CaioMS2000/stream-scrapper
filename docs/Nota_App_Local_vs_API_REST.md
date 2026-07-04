# Nota — por que um app local/daemon parece diferente de uma API REST

> **Natureza deste doc:** orientação mental, não spec. Registra a diferença de *forma* entre este projeto (daemon local, "meio desktop") e a API REST web clássica — porque essa diferença é a causa real da sensação de "travar pra começar", e ela some quando você a nomeia. Companheiro do §7 do fluxo headless da `Arquitetura_VOD_Archiver.md`.

---

## O contraste em uma frase

Numa API REST web, **o request dirige tudo**. Aqui, **nada te chama** — o motor roda sozinho.

---

## O que muda de verdade

Numa API web clássica, todo caminho de código só roda porque **alguém bateu num endpoint**. O framework é dono do ciclo de vida, do "quando", da concorrência (N requests independentes), e o estado mora no banco entre requests. Você preenche funções que **reagem** a requisições.

Um daemon local é o avesso disso em cinco pontos:

1. **Nada te chama.** O motor roda *sozinho* — loop do `monitor`, pool do `recorder`. Você é dono do processo, do main loop, do shutdown gracioso (SIGINT), de manter o processo vivo. Ninguém do lado de fora empurra o trabalho.

2. **Estado vive na memória do processo.** Handles de gravação ativos, referências de subprocesso, o mapa "último estado conhecido" do monitor, conexões WebSocket. O **processo *é* o portador do estado**, não o banco. (Numa API REST, o processo é quase stateless entre requests.)

3. **Você orquestra subprocessos** (ffmpeg/streamlink) — spawn, ler stdout/stderr, matar no stop, supervisionar. Não existe isso em CRUD web.

4. **A concorrência é sua.** Não é "atender N requests independentes" — é "manter M jobs de longa duração vivos ao mesmo tempo e coordená-los" (um pool). Natureza diferente.

5. **O mundo externo e o tempo geram os eventos**, não o usuário. Streamer sobe → você reage. É orientado a evento/polling, não a request.

Isso é a diferença "desktop/daemon" — e é **real**, não impressão. A classe de referência certa não é "API REST corporativa"; é **qBittorrent / Sonarr / gerenciador de download**: CRUD + workers de fundo + adapters de integração, tudo num processo. (Ver também a análise "super CRUD" — o domínio é magro; a complexidade essencial é **operacional** e de **integração**, não de domínio.)

---

## A consequência prática (como isso vira código)

- **A `api` (REST + WS) é opcional e vem depois.** Ela é só uma *casca* que expõe o motor. O motor precisa rodar **headless** primeiro — é o fluxo do §7 da arquitetura, o caminho que "nunca toca a UI".
- **Você é o cliente no começo.** Não tem browser/Postman batendo em você. Por isso a **CLI interina** (`Arquitetura` §10) existe: é o driver de teste enquanto não há UI. Ou um teste E2E direto.
- **Destravar = spike, não arquitetura.** A paralisia vem de encarar 8 módulos numa página em branco. O antídoto é um arquivo descartável que responde a *única pergunta incerta* (a dança com a Twitch funciona e eu ponho bytes no disco?), e só depois retrofitar as fronteiras de módulo em cima de código que já roda. Foi exatamente o papel do primeiro `index.ts`.

---

## O risco que ninguém avisa (mas importa na prática)

O perigo do monólito modular **não** é excesso de cerimônia — é o **oposto**: a fronteira de módulo só existe **por disciplina**. Num processo Node único, nada te impede de importar o interno de outro módulo ou escrever SQL fora do `store`. No dia em que alguém faz isso, a modularidade evapora silenciosamente e vira big ball of mud com pastas bonitas.

- A regra "**só o `store` toca SQL e monta path**" é o que segura isso — mas é regra, não trava do compilador.
- O `store` compartilhado é o **ponto de acoplamento central** (todos dependem dele) → candidato a virar "god module". Mantê-lo **burro** (CRUD + paths, sem lógica de negócio) é o que evita.

---

*Nota de orientação — a forma do projeto é daemon, não request/response. Nomear isso é metade do destravamento.*
