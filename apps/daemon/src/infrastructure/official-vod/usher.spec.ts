import { describe, expect, test } from 'bun:test'
import { parseMasterPlaylist } from './usher'

// Master playlist real, capturado via apps/daemon/spikes/03-playback-access-token.sh
// contra o vodId 2841524354 (apofigeaa, público) em 2026-08-24. Ver
// docs/design/002-download-de-vods.md, seção C.
const REAL_MASTER_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="SA",USER-IP="2804:d59:9a14:1300:7966:4d91:4030:cdf2",SERVING-ID="cddecbf8947844d5b04e385934d3fd3d",CLUSTER="cloudfront_vod",USER-COUNTRY="BR",MANIFEST-CLUSTER="cloudfront_vod"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4026386,CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=29.934
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/chunked/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p30",NAME="720p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=2325609,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p30",FRAME-RATE=29.934
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/720p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1408142,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=852x480,VIDEO="480p30",FRAME-RATE=29.934
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/480p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="360p30",NAME="360p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=709650,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,VIDEO="360p30",FRAME-RATE=29.934
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/360p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="160p30",NAME="160p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=289672,CODECS="avc1.4D400C,mp4a.40.2",RESOLUTION=284x160,VIDEO="160p30",FRAME-RATE=29.934
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/160p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="Audio Only",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=175005,CODECS="mp4a.40.2",VIDEO="audio_only"
https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/audio_only/index-dvr.m3u8
`

describe('parseMasterPlaylist', () => {
	test('extrai as 6 variantes reais com groupId/name/url corretos', () => {
		const variants = parseMasterPlaylist(REAL_MASTER_PLAYLIST)

		expect(variants).toEqual([
			{
				groupId: 'chunked',
				name: '1080p',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/chunked/index-dvr.m3u8',
			},
			{
				groupId: '720p30',
				name: '720p',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/720p30/index-dvr.m3u8',
			},
			{
				groupId: '480p30',
				name: '480p',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/480p30/index-dvr.m3u8',
			},
			{
				groupId: '360p30',
				name: '360p',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/360p30/index-dvr.m3u8',
			},
			{
				groupId: '160p30',
				name: '160p',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/160p30/index-dvr.m3u8',
			},
			{
				groupId: 'audio_only',
				name: 'Audio Only',
				url: 'https://d3fi1amfgojobc.cloudfront.net/85162296b4d7b239523d_apofigeaa_318044569575_1786285382/audio_only/index-dvr.m3u8',
			},
		])
	})

	test('playlist vazio → nenhuma variante', () => {
		expect(parseMasterPlaylist('#EXTM3U\n')).toEqual([])
	})
})
