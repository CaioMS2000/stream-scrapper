1. Fontes de dados alternativas (para recuperar stream_id e timestamp)
TwitchTracker: https://twitchtracker.com/{streamer}/streams – lista todas as streams passadas com stream_id e start_time.

Streamscharts: https://streamscharts.com/twitch/{streamer}/streams – similar.

SullyGnome: https://sullygnome.com/streamer/{streamer}/streams – histórico detalhado.

Observação importante: Esses sites fazem scraping da Twitch, então podem ter latência (atualização a cada poucos minutos) e nem sempre capturam lives curtas (< 5 min). São um fallback, não a fonte primária.

2. Limitações da CDN da Twitch (janela de retenção)
VODs ficam disponíveis na CDN por cerca de 60 dias após a live.

Para canais não-parceiros, o VOD pode ser deletado automaticamente em 7 a 14 dias (dependendo das configurações do streamer).

Segmentos mutados (música com copyright) têm uma versão -muted no m3u8 – você precisa substituir as URLs para baixar o áudio original (se disponível).

3. Headers necessários para requisições GraphQL
Client-ID: kimne78kx3ncx6brgo4mv6wki5h1ko – este é o ID público do cliente web da Twitch (pode ser usado sem autenticação).

Em algumas queries, a Twitch pede o header Client-Integrity (um token JWT gerado por um script ofuscado). Para PlaybackAccessToken e queries básicas, geralmente não é exigido, mas se começar a dar erro 403, você precisa obter esse token.

4. Persisted Query Hashes (os hashes das queries GraphQL)
A Twitch usa Apollo persisted queries. O hash da query PlaybackAccessToken muda de tempos em tempos.

O hash atual (em maio de 2026) é: 0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712.

Dica: quando a extensão parar de funcionar, é quase certo que esse hash mudou – você precisa atualizá-lo inspecionando o tráfego da Twitch no DevTools.

5. Rate Limits
Helix API (monitoramento): 800 requisições por minuto para tokens de app (é muito, você não vai bater).

Usher (pegar m3u8): ~20 requisições por minuto por IP – se você fizer muitas chamadas, pode tomar 429.

CDN (segmentos): Não há rate limit agressivo, mas baixar 1000 segmentos de uma vez pode saturar sua conexão. Use paralelismo controlado (10-20 workers/threads).

6. Comportamento de streams ao vivo (m3u8 dinâmico)
O arquivo index-dvr.m3u8 de uma live é atualizado a cada ~2-4 segundos.

Ele contém os últimos ~60 segundos de segmentos (ou seja, você não consegue voltar muito no tempo se começar a gravar depois que a live já começou).

Para gravar do início da live, você precisa estar monitorando antes dela começar (daí a importância do polling constante).

7. FFmpeg comandos úteis
Juntar segmentos .ts em .mp4:

```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
```
Onde filelist.txt contém a lista de segmentos na ordem correta.

Para baixar diretamente de um m3u8 (sem salvar segmentos intermediários):

```bash
ffmpeg -i "https://...index-dvr.m3u8" -c copy output.mp4
```
(Útil para VODs, mas para gravação ao vivo você quer baixar os segmentos manualmente para ter controle sobre interrupções.)

8. Verificação de integridade
Alguns segmentos podem vir corrompidos (especialmente se a conexão cair). Você deve verificar se o arquivo .ts tem o cabeçalho correto (0x47 no byte 0) e, se não, tentar baixar novamente (com retry exponencial).

9. Considerações sobre sub-only VODs
Para baixar VODs restritos a inscritos, você precisa de um token OAuth de uma conta que seja sub do canal.

A extensão faz isso herdando os cookies do navegador. No seu sistema local, você pode exportar os cookies do navegador (ex.: via extensão "cookies.txt") e passar para o seu programa.

10. Alternativas de fallback – yt-dlp
O yt-dlp já implementa o fluxo de download de VODs da Twitch (públicos) e pode ser usado como fallback para casos que seu sistema ainda não cobre.

Você pode chamar yt-dlp https://twitch.tv/videos/{vod_id} via subprocesso se a sua implementação falhar.
