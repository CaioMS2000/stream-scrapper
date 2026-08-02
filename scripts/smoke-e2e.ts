#!/usr/bin/env bun
// Smoke E2E: sobe o daemon como subprocess real, exercita comandos CLI reais,
// verifica exit codes e saída. Toca Twitch de verdade — pré-condição: internet
// funcional e Twitch GQL respondendo. Isolamento total via mkdtemp: data dir
// próprio + socket próprio, não interfere com daemon real que talvez esteja
// rodando na máquina.
//
// Uso: bun scripts/smoke-e2e.ts (do root do monorepo)
//
// Fora do fluxo automatizado — CI que só chame `bun test` não roda isso.
// Usado antes de release/refactor grande pra confirmar que o pipe real
// (daemon + IPC + CLI + Twitch) ainda funciona ponta a ponta.

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DAEMON_ENTRY = join(REPO_ROOT, 'apps/daemon/src/main.ts')
const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/index.ts')

const tmpDir = mkdtempSync(join(tmpdir(), 'scrapper-smoke-'))
const socketPath = join(tmpDir, 'ipc.sock')
const env = {
	...process.env,
	STREAM_SCRAPPER_DATA_DIR: tmpDir,
	STREAM_SCRAPPER_SOCKET: socketPath,
}

console.log('[smoke] data dir isolado:', tmpDir)
console.log('[smoke] socket isolado:', socketPath)

const daemon = Bun.spawn(['bun', 'run', DAEMON_ENTRY], {
	env,
	stdout: 'inherit',
	stderr: 'inherit',
})

// SIGINT do usuário durante o smoke: mata daemon + limpa tmp antes de sair.
process.on('SIGINT', () => {
	console.log('\n[smoke] SIGINT recebido — matando daemon e limpando')
	daemon.kill('SIGTERM')
	rmSync(tmpDir, { recursive: true, force: true })
	process.exit(130)
})

let failed = false
try {
	await waitForSocket(socketPath, 5000)

	await assertCli(['ping'], /daemon vivo/)
	await assertCli(['add-channel', 'twitch'], /adicionado/)
	await assertCli(['add-channel', 'twitch'], /already registered/, {
		expectExitCode: 1,
	})
	await assertCli(['enable-auto-recording', 'twitch'], /auto-record ligado/)
	await assertCli(
		['enable-auto-recording', 'ghost-does-not-exist-xyz'],
		/not found/i,
		{ expectExitCode: 1 }
	)

	console.log('[smoke] ✓ ALL PASSED')
} catch (err) {
	console.error(
		'[smoke] ✗ FAILED:',
		err instanceof Error ? err.message : String(err)
	)
	failed = true
} finally {
	daemon.kill('SIGTERM')
	await daemon.exited
	rmSync(tmpDir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)

// ── helpers ────────────────────────────────────────────────────────────────

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (existsSync(path)) return
		await Bun.sleep(50)
	}
	throw new Error(`timeout: socket ${path} não apareceu em ${timeoutMs}ms`)
}

async function assertCli(
	args: string[],
	outputPattern: RegExp,
	opts: { expectExitCode?: number } = {}
): Promise<void> {
	const expectedExit = opts.expectExitCode ?? 0
	const label = args.join(' ')

	const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
		env,
		stdout: 'pipe',
		stderr: 'pipe',
	})
	await proc.exited
	const stdout = await new Response(proc.stdout).text()
	const stderr = await new Response(proc.stderr).text()
	const combined = stdout + stderr

	if (proc.exitCode !== expectedExit) {
		throw new Error(
			`[${label}] exit code ${proc.exitCode}, esperado ${expectedExit}\n  stdout: ${stdout.trim()}\n  stderr: ${stderr.trim()}`
		)
	}
	if (!outputPattern.test(combined)) {
		throw new Error(
			`[${label}] output não bateu com ${outputPattern}\n  stdout: ${stdout.trim()}\n  stderr: ${stderr.trim()}`
		)
	}

	console.log(`[smoke] ✓ ${label}`)
}
