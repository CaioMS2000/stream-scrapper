#!/usr/bin/env bun

// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: envs de config
// desse bootstrap (FFMPEG_VERSION, STREAMLINK_VERSION, FFMPEG_SHA256) são
// opcionais e específicas do setup — não fazem parte do runtime do daemon,
// então não vivem no schema de env.ts.

// Bootstrap de binários: baixa ffmpeg estático + instala streamlink num venv.
// Bun-native — usa Bun.$ pra shell, Bun.file/Bun.write pra I/O, fetch global.
//
// Uso:
//   bun setup.ts                 # ffmpeg + streamlink
//   bun setup.ts --no-streamlink # só ffmpeg
//   bun setup.ts --no-ffmpeg     # só streamlink
//   bun setup.ts --force         # rebaixa mesmo se já existir
//
// Resultado (paths ancorados no daemon, coerentes com config.ts):
//   apps/daemon/bin/ffmpeg
//   apps/daemon/bin/ffprobe
//   apps/daemon/venv/bin/streamlink
//
// `apps/daemon/bin/` e `apps/daemon/venv/` estão no .gitignore.

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { $ } from 'bun'

// ---------------------------------------------------------------- config

// Versão do ffmpeg. Fixada por default pra reprodutibilidade. Use
// FFMPEG_VERSION="release" pra pegar a última (não reproduzível — muda com o
// tempo, log da versão baixada aparece no output pra você fixar aqui depois).
const FFMPEG_VERSION = process.env.FFMPEG_VERSION ?? '7.0.2'

// Versão do streamlink instalada no venv. Bump quando plugin da Twitch quebrar
// (histórico: mudanças no site quebram plugin ~1x por semestre).
const STREAMLINK_VERSION = process.env.STREAMLINK_VERSION ?? '7.3.0'

// Hash forte opcional. Se preenchido (sha256 hex), a verificação passa a ser
// estrita contra esse valor. Vazio = só confere o md5 publicado ao lado do
// tarball, que pega download corrompido/truncado mas não servidor comprometido.
const FFMPEG_SHA256 = process.env.FFMPEG_SHA256 ?? ''

// Ancorado no local DESTE script — funciona de qualquer cwd (bun setup.ts,
// bun run setup, node setup.ts em qualquer subpasta, todos resolvem igual).
const ROOT = import.meta.dir
const DAEMON_DIR = path.join(ROOT, 'apps', 'daemon')
const BIN_DIR = path.join(DAEMON_DIR, 'bin')
const VENV_DIR = path.join(DAEMON_DIR, 'venv')

// ---------------------------------------------------------------- helpers

const args = new Set(process.argv.slice(2))
const FORCE = args.has('--force')
const SKIP_STREAMLINK = args.has('--no-streamlink')
const SKIP_FFMPEG = args.has('--no-ffmpeg')

const log = (...m: unknown[]) => console.log('•', ...m)
const warn = (...m: unknown[]) => console.warn('!', ...m)

async function has(cmd: string): Promise<boolean> {
	try {
		await $`which ${cmd}`.quiet()
		return true
	} catch {
		return false
	}
}

async function exists(p: string): Promise<boolean> {
	return await Bun.file(p).exists()
}

// GET com backoff — cobre 99% dos casos de "rede oscilou" sem virar problema
// pro dev. Total worst case: 3 tentativas separadas por 1s+2s = ~5s de espera.
async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
	let lastError: unknown
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, { redirect: 'follow' })
			if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
			return res
		} catch (err) {
			lastError = err
			if (attempt < retries) {
				const delay = 1000 * 2 ** attempt
				warn(
					`fetch falhou (tentativa ${attempt + 1}/${retries + 1}), retry em ${delay / 1000}s`
				)
				await Bun.sleep(delay)
			}
		}
	}
	throw lastError
}

// Baixa `url` pra `dest`, devolve sha256+md5 do conteúdo gravado. Carrega
// o arquivo em memória (~40-100MB) — trade off consciente vs streaming
// hash: código muito mais simples, e o dev tem RAM sobrando.
async function download(
	url: string,
	dest: string
): Promise<{ sha256: string; md5: string }> {
	const res = await fetchWithRetry(url)
	const buf = new Uint8Array(await res.arrayBuffer())
	await Bun.write(dest, buf)
	return {
		sha256: createHash('sha256').update(buf).digest('hex'),
		md5: createHash('md5').update(buf).digest('hex'),
	}
}

// os.arch() → nomenclatura dos builds do John Van Sickle (fonte canônica de
// ffmpeg estático pra Linux).
function ffmpegArch(): string {
	switch (os.arch()) {
		case 'x64':
			return 'amd64'
		case 'arm64':
			return 'arm64'
		case 'arm':
			return 'armhf'
		default:
			throw new Error(`arquitetura não suportada: ${os.arch()}`)
	}
}

function ffmpegUrl(arch: string): string {
	const base = 'https://johnvansickle.com/ffmpeg'
	return FFMPEG_VERSION === 'release'
		? `${base}/releases/ffmpeg-release-${arch}-static.tar.xz`
		: `${base}/old-releases/ffmpeg-${FFMPEG_VERSION}-${arch}-static.tar.xz`
}

// ---------------------------------------------------------------- ffmpeg

async function setupFfmpeg(): Promise<void> {
	const target = path.join(BIN_DIR, 'ffmpeg')
	if (!FORCE && (await exists(target))) {
		log(`ffmpeg já existe em ${target} (use --force pra rebaixar)`)
		return
	}

	const arch = ffmpegArch()
	const url = ffmpegUrl(arch)
	log(`baixando ffmpeg (${arch}) de ${url}`)

	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-'))
	try {
		const tarPath = path.join(tmp, 'ffmpeg.tar.xz')
		const { sha256, md5 } = await download(url, tarPath)

		if (FFMPEG_SHA256) {
			if (sha256 !== FFMPEG_SHA256.toLowerCase()) {
				throw new Error(
					`sha256 não confere.\n  esperado: ${FFMPEG_SHA256}\n  obtido:   ${sha256}`
				)
			}
			log('sha256 confere com o valor fixado')
		} else {
			// md5 publicado ao lado do tarball: pega corrupção, não adulteração.
			try {
				const txt = await (await fetchWithRetry(`${url}.md5`)).text()
				const expected = txt.trim().split(/\s+/)[0]?.toLowerCase()
				if (expected && expected !== md5) {
					throw new Error(
						`md5 não confere.\n  esperado: ${expected}\n  obtido:   ${md5}`
					)
				}
				log(
					expected
						? 'md5 confere com o publicado'
						: 'md5 publicado indisponível'
				)
			} catch (e) {
				warn(`não foi possível verificar md5: ${(e as Error).message}`)
			}
			warn('sem hash forte fixado — considere setar FFMPEG_SHA256 (log abaixo)')
		}
		log(`sha256 do download: ${sha256}`)

		// tar do Linux auto-detecta .xz se xz-utils estiver presente.
		try {
			await $`tar -xf ${tarPath} -C ${tmp}`
		} catch {
			throw new Error(
				"falha ao extrair — instale o pacote 'xz-utils' e tente de novo"
			)
		}

		// Tarball extrai numa pasta tipo ffmpeg-7.0.2-amd64-static/
		const entries = await fs.readdir(tmp, { withFileTypes: true })
		const dir = entries.find(
			e => e.isDirectory() && e.name.startsWith('ffmpeg-')
		)
		if (!dir) throw new Error('pasta extraída não encontrada')
		const version = dir.name.replace(/^ffmpeg-|-.*static$/g, '')
		log(`versão extraída: ${version}`)
		if (FFMPEG_VERSION === 'release') {
			log(`  → pra reproduzir, fixe FFMPEG_VERSION="${version}" no setup`)
		}

		await fs.mkdir(BIN_DIR, { recursive: true })
		for (const name of ['ffmpeg', 'ffprobe']) {
			const from = path.join(tmp, dir.name, name)
			const to = path.join(BIN_DIR, name)
			await fs.copyFile(from, to)
			await fs.chmod(to, 0o755)
			log(`instalado ${to}`)
		}
	} finally {
		await fs.rm(tmp, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------- streamlink

async function setupStreamlink(): Promise<void> {
	const target = path.join(VENV_DIR, 'bin', 'streamlink')
	if (!FORCE && (await exists(target))) {
		log(`streamlink já existe em ${target} (use --force pra reinstalar)`)
		return
	}

	if (!(await has('python3'))) {
		warn('python3 não encontrado no PATH — pulando streamlink')
		warn('  instale o python3 e rode de novo, ou use --no-streamlink')
		return
	}

	log(`criando venv em ${VENV_DIR}`)
	await $`python3 -m venv ${VENV_DIR}`

	const pip = path.join(VENV_DIR, 'bin', 'pip')
	log(`instalando streamlink==${STREAMLINK_VERSION}`)
	await $`${pip} install streamlink==${STREAMLINK_VERSION} --quiet`
	log(`instalado ${target}`)
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
	if (process.platform !== 'linux') {
		warn(`este script assume Linux; plataforma atual: ${process.platform}`)
	}

	if (!SKIP_FFMPEG) await setupFfmpeg()
	else log('ffmpeg pulado (--no-ffmpeg)')

	if (!SKIP_STREAMLINK) await setupStreamlink()
	else log('streamlink pulado (--no-streamlink)')

	console.log('\nPronto. O daemon já procura nesses caminhos por padrão:')
	console.log(`  ffmpeg:     ${path.join(BIN_DIR, 'ffmpeg')}`)
	console.log(`  ffprobe:    ${path.join(BIN_DIR, 'ffprobe')}`)
	if (!SKIP_STREAMLINK) {
		console.log(`  streamlink: ${path.join(VENV_DIR, 'bin', 'streamlink')}`)
	}
}

main().catch(err => {
	console.error('\nFalha no setup:', err instanceof Error ? err.message : err)
	process.exit(1)
})
