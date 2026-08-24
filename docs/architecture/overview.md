# Arquitetura — visão C4

Diagramas em [C4 Model](https://c4model.com/): Context (nível 1) e Container
(nível 2) cobrem a maioria das perguntas de "o que é isso e como se
comunica"; um diagrama Dynamic complementa mostrando o fluxo assíncrono mais
importante do sistema em tempo de execução. Component/Code (níveis 3-4) foram
deixados de fora deliberadamente — nenhum container aqui é complexo o
suficiente pra justificar esse zoom; a leitura do código em
[apps/daemon/src/](../../apps/daemon/src/) resolve melhor esse nível de
detalhe do que um diagrama desenhado à mão.

Decisões que moldam estes diagramas estão registradas em
[docs/decisions/](../decisions/).

## Nível 1 — System Context

Quem usa o stream-scrapper e com quais sistemas externos ele conversa.

```mermaid
flowchart TB
    operador["👤 Operador<br/>(pessoa)<br/><br/>Cadastra canais e habilita<br/>gravação automática via CLI"]

    subgraph boundary["stream-scrapper"]
        sistema["📦 stream-scrapper<br/>(daemon + CLI)<br/><br/>Monitora canais, detecta<br/>transições online/offline<br/>e grava lives automaticamente"]
    end

    twitch["🌐 Twitch<br/>(sistema externo)<br/><br/>Plataforma de streaming:<br/>API Helix/GQL + playback HLS"]

    operador -- "executa comandos\n(add-channel, ping, ...)" --> sistema
    sistema -- "consulta status online/offline\ne consome playlist HLS assinado" --> twitch

    style boundary fill:transparent,stroke:#888,stroke-dasharray: 4 3
```

**Legenda:** caixa tracejada = fronteira do sistema. Setas rotuladas com o
verbo da relação (não são só "conexões" — dizem o que passa por elas).

## Nível 2 — Containers

Zoom pra dentro da fronteira: as unidades que rodam separadamente e como se
falam. "Container" aqui é qualquer coisa que executa isolada — processo,
datastore, subprocesso — **não** é container Docker (o projeto não usa
Docker).

```mermaid
flowchart TB
    operador["👤 Operador"]
    twitch["🌐 Twitch API<br/>(Helix/GQL + HLS)"]

    subgraph boundary["stream-scrapper"]
        cli["🖥️ CLI<br/>(apps/cli)<br/><br/>Bun + commander<br/><br/>Thin adapter: parseia argv,<br/>fala com o daemon"]
        daemon["⚙️ Daemon<br/>(apps/daemon)<br/><br/>Bun, processo long-running<br/><br/>Monitor + use cases + IPC server,<br/>núcleo hexagonal"]
        db[("🗄️ SQLite<br/>(bun:sqlite + Drizzle)<br/><br/>Canais e streams")]
        fs["📁 Filesystem<br/><br/>.ts/.mp4 + meta.json<br/>sidecar por gravação"]
        streamlink["🎬 streamlink<br/>(subprocess)<br/><br/>1 processo por<br/>gravação ativa"]
    end

    operador -- "invoca" --> cli
    cli -- "comandos via Unix socket,\nNDJSON, protocolo tipado\n(@repo/ipc)" --> daemon
    daemon -- "lê/escreve canais e streams\nvia Drizzle ORM" --> db
    daemon -- "escreve meta.json sidecar" --> fs
    daemon -- "spawna e supervisiona\n(Bun.spawn), 1 por gravação" --> streamlink
    streamlink -- "escreve .ts bruto\n(sem re-encoding)" --> fs
    daemon -- "poll de status\n(Monitor, GQL não-documentado)" --> twitch
    streamlink -- "consome playlist HLS assinado,\nre-autentica em token expirado" --> twitch

    style boundary fill:transparent,stroke:#888,stroke-dasharray: 4 3
```

**Legenda:** retângulo = processo/aplicação · cilindro = datastore ·
pasta = filesystem · fronteira tracejada = mesmo host (ver
[ADR 003](../decisions/003-unix-socket-ipc.md), CLI e daemon sempre rodam
juntos). `packages/ipc` não aparece como container próprio — é a biblioteca
de protocolo compilada dentro dos dois processos, não uma unidade que roda
sozinha.

## Diagrama suplementar — Dynamic: canal fica live → grava → finaliza

O fluxo mais espinhoso do sistema é assíncrono e atravessa dois driving
adapters (Monitor e IPC) através do EventBus — ver
[events-evolution.md](../../apps/daemon/notes/events-evolution.md) e
[monitor-tick-serialization.md](../../apps/daemon/notes/monitor-tick-serialization.md)
pro raciocínio completo por trás dele. Este diagrama fixa o cenário de
sucesso ponta-a-ponta.

```mermaid
sequenceDiagram
    participant Twitch as Twitch API
    participant Monitor as ChannelMonitor
    participant Bus as EventBus
    participant UC as StartRecordingUseCase
    participant DB as SQLite
    participant FS as Filesystem
    participant Rec as StreamRecorder
    participant SL as streamlink (subprocess)

    Note over Monitor: tick de poll (~30s)
    Monitor->>Twitch: consulta status dos canais
    Twitch-->>Monitor: canal X está ao vivo
    Monitor->>Bus: publish(ChannelLiveEvent)
    Bus->>UC: execute(channelName, streamId, ...)
    UC->>DB: createStream() — INSERT com UNIQUE(streamId)
    UC->>FS: writeStreamMeta(status: "recording")
    UC->>Rec: recordTwitchStream()
    Rec->>SL: Bun.spawn(streamlink ...)
    activate SL
    SL->>Twitch: consome playlist HLS assinado
    Note over SL,Twitch: re-autentica quando o token expira,\ngrava .ts bruto durante toda a live
    SL->>FS: escreve segments no .ts

    Note over SL: live termina, processo sai
    SL-->>Rec: proc.exited
    deactivate SL
    Rec->>Bus: publish(RecordingFinishedEvent)
    Bus->>UC: FinalizeRecordingUseCase.execute(...)
    UC->>FS: reescreve meta.json (endedAt, bytes, status: "finished")
```

**Legenda:** setas cheias = chamada síncrona/await · seta tracejada = retorno
ou evento assíncrono · `Note over` = observação temporal, não uma mensagem.
