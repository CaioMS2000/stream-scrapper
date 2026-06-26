# Módulo `recorder` — spec de design

> Companheiro da seção 9 do documento de arquitetura. Detalha o módulo que implementa o **caminho 3 de aquisição** (gravação ao vivo). Ainda **language-agnostic**. É a menor fatia ponta a ponta do produto: `monitor` detecta live → `recorder` captura → `store` salva → existe um `.mp4` no disco.

---

## 1. Papel e princípio

O `recorder` puxa o HLS **ao vivo** de um streamer que acabou de subir e salva uma cópia própria em disco enquanto a transmissão acontece. É:

- **A única rota proativa.** Tem que estar rodando *quando* a stream sobe — não recupera passado.
- **A única com garantia.** A cópia é sua; sobrevive a deleção, sub-only e expiração da CDN, porque foi feita no ar, antes de qualquer restrição existir.
- **O coração da referência de produto** (o lado "streamrecorder"), enquanto `twitch`+`downloader` são o lado "voddownloader".

Princípio de design, coerente com o resto: **o trabalho pesado (capturar + muxar) é delegado a um binário nativo**; o `recorder` só orquestra. E o motor de captura fica **atrás de uma interface**, exatamente como a linguagem do daemon — trocável depois sem mexer no resto.

---

## 2. Posição no fluxo

- **Gatilho:** `monitor` emite `streamer.live` para um streamer com `auto_record = true` (ou disparo manual pela API).
- **Depende de:** `twitch` (manifesto ao vivo / token), `store` (onde escrever + linhas no banco), `events` (progresso).
- **Produz:** `recording.mp4` (+ `segments/` opcional) e uma linha em `recordings`.

---

## 3. A decisão do motor de captura (a parte que importa)

Há três formas de capturar HLS ao vivo, com uma tensão arquitetural real entre elas:

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. streamlink** | `streamlink twitch.tv/{canal} {qualidade} -o saida.ts` | feito sob medida pra Twitch: lida com ads, descontinuidades, reconexão e **re-auth** sozinho | faz a **própria token dance** → duplica/contorna seu módulo `twitch`; dependência Python |
| **B. ffmpeg no manifesto** | `ffmpeg -i {live.m3u8} -c copy saida.mp4` | binário único que você já tem; consome o manifesto que **seu** `twitch` resolveu | frágil aos detalhes de live; **o token na URL do usher expira** no meio de uma stream longa e o ffmpeg morre |
| **C. puller próprio** | seu loop lê o media playlist rolante, baixa os `.ts` novos, re-pede manifesto ao `twitch` quando o token vence; ffmpeg só no remux final | controle total; mantém o `twitch` como dono único da comunicação | mais trabalho |

**O ponto que decide:** o token do usher vive minutos; uma stream de 6h o ultrapassa. A opção B (ffmpeg cru no manifesto) **morre no meio de stream longa** quando o token expira — então ela é adequada pro `downloader` (VOD: playlist fechada, um token só), mas **errada pro `recorder`** (live longo, token que expira). Isso restringe a escolha real a A ou C.

**Recomendação MVP:** comece com **A (streamlink)** — é o caminho mais rápido pra um `.mp4` funcional e já lida com os perrengues de live. Aceite a dívida arquitetural consciente: o streamlink refaz a token dance, então nesse ponto o `twitch` não é o dono único da comunicação. A versão "limpa" migra pra **C (puller próprio alimentado pelo `twitch`)** — e, por isso, o motor de captura fica atrás da interface `CaptureEngine` (seção 4), pra essa troca ser indolor.

---

## 4. Interface pública (language-agnostic)

```
startRecording(streamMeta, opts) -> RecordingHandle
stopRecording(recordingId)        -> void          -- encerra gracioso, finaliza o arquivo
listActive()                      -> RecordingHandle[]
```

Motor de captura atrás de interface (o que torna A→C trocável):

```
interface CaptureEngine {
  capture(source, outputPath, quality, callbacks) -> ProcessHandle
}
-- implementações: StreamlinkEngine (MVP) | SegmentPullerEngine (limpo) | FfmpegEngine (só p/ downloader)
-- callbacks: onProgress(durationS, bytes), onEnd(reason), onError(err)
```

`source` é abstrato de propósito: pro StreamlinkEngine é o login do canal; pro SegmentPullerEngine é o `Manifest` que o `twitch` resolveu. A interface esconde a diferença.

---

## 5. Tipos

```
RecordingHandle {
  id          : string
  streamId    : string
  status      : 'recording' | 'completed' | 'failed'
  startedAt   : int
  quality     : string
  storagePath : string
  process     : ProcessHandle        -- handle do subprocesso, p/ stop
}
```

---

## 6. Ciclo de vida da gravação

Estados: `recording → completed` (caminho feliz) ou `recording → failed` (com arquivo parcial preservado).

1. **Start.** Recebe `StreamMeta` + qualidade → (StreamlinkEngine: passa o canal; SegmentPullerEngine: `twitch.resolveLiveManifest` + `selectQuality`) → spawna o motor escrevendo `recording.ts` → insere `recordings` (status `recording`) → escreve `meta.json` → emite `recording.started`.
2. **Progress.** Lê stdout/stderr do motor, parseia duração/bytes, emite `recording.progress` **throttled** (ex.: a cada 5–10 s, não a cada segmento).
3. **End.** Stream encerra (`#EXT-X-ENDLIST` / motor sai limpo / canal offline) → **finaliza** (remux `.ts → .mp4`, seção 7) → status `completed`, grava `ended_at`/`bytes` → emite `recording.completed`.
4. **Stop manual.** `POST /api/recordings/:id/stop` → termina o motor com sinal gracioso (deixa finalizar o arquivo) → status `completed`.
5. **Failure.** Crash do motor / disco cheio / rede perdida além do retry → status `failed`, emite `recording.failed`, **mantém o arquivo parcial** (parcial é melhor que nada pra live) e tenta finalizá-lo pra ficar tocável.

---

## 7. Política de arquivo parcial (gotcha importante)

**Grave em `.ts`, remuxe pra `.mp4` no fim.** Razão: gravar direto em mp4 com `-c copy` deixa o arquivo **inutilizável se a captura for interrompida** — o `moov atom` (índice) só é escrito no encerramento, então um mp4 truncado não toca. Já o container `.ts` é robusto a truncamento: mesmo cortado no meio, ainda reproduz.

Fluxo: motor escreve `recording.ts` (append-as-you-go) → no finalize, `ffmpeg -i recording.ts -c copy recording.mp4` → opcionalmente mantém ou descarta o `.ts`. Assim, **qualquer interrupção ainda rende um arquivo assistível**, que é o ponto inteiro de gravar ao vivo.

(`segments/` cru é opcional, pra quem quer os `.ts` individuais; o default é só o `.ts` consolidado.)

---

## 8. Concorrência e a nota da "frota"

Cada gravação = um subprocesso + uma task assíncrona supervisora. O `recorder` gerencia um **pool** de gravações simultâneas (uma por streamer monitorado que está ao vivo).

- **"Só seu" (poucos streamers):** trivial; o async do Node dá conta de sobra.
- **"Frota" (dezenas/centenas simultâneas):** é exatamente aqui que o perfil operacional do Go começa a pagar — goroutines baratas, memória previsível, binário único como serviço. Mas note: o trabalho continua **I/O-bound** (cada gravação é esperar segmento + repassar ao disco), então o Node também aguenta; a vantagem do Go é operacional, não "o Node não dá conta".

Ou seja: o `recorder` **é o módulo cujas características de escala decidiriam Node-vs-Go** lá na frente. Enquanto for "só seu", a questão nem se coloca.

---

## 9. Sub-only ao vivo (o caso de borda)

Gravar uma live **pública** não exige auth nenhuma — é o caso comum. Gravar uma live que já é **sub-only ao vivo** (broadcast trancado pra inscritos) exige que o token live carregue inscrição → `cookies.txt` de uma conta sub (caminho 1 aplicado ao ao-vivo). Sem isso, não dá — e aqui **não existe** o atalho da CDN, porque a opção 2 só vale pra VOD pós-fato. É o único conteúdo que o `recorder` não alcança sem direito real.

(Lembrando: na esmagadora maioria, o paywall é aplicado *depois*. Gravando a live pública você fica com a cópia mesmo que o VOD vire sub-only em seguida.)

---

## 10. Modos de falha

| Sintoma | Reação |
|---|---|
| motor de captura crasha | retry 1×; se persistir, `failed` + mantém parcial finalizado |
| disco cheio | para, `failed`, alerta na UI |
| conexão do streamer cai no meio | streamlink reconecta; se encerrou de fato, finaliza normal |
| token expira (só relevante se usar ffmpeg cru) | o motivo de **não** usar a opção B pro recorder |
| live sub-only sem cookie de sub | `failed` com motivo claro "exige inscrição" (seção 9) |

---

## 11. O que fica adiado

- **Captura de chat** junto do vídeo.
- **Transcode/re-encode** — manter `-c copy` (sem recodificar) no MVP.
- **Stripping inteligente de segmentos de ad.**
- **Captura simultânea de múltiplas qualidades.**
- **Migração para o `SegmentPullerEngine`** (a versão limpa que mantém o `twitch` como dono único) — depois que o streamlink provar o fluxo.

---

*Spec do módulo `recorder` — versão inicial. A decisão de motor de captura (seção 3) é a única escolha de verdade aqui; o resto é orquestração.*
