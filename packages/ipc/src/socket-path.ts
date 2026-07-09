import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Caminho do arquivo de socket, resolvido igual dos dois lados (daemon faz bind,
// CLI conecta). Mesmo padrão default+override do config.ts do daemon.
//
// O default fica no runtime dir do usuário ($XDG_RUNTIME_DIR) — que é o lugar
// correto pra sockets efêmeros, e NÃO o dataDir (esse é pra arquivos que
// persistem: banco, vídeos). Fallback pro tmpdir do SO quando XDG não existe.
export function resolveSocketPath(): string {
	const override = process.env.STREAM_SCRAPPER_SOCKET
	if (override) {
		return override
	}

	const runtimeDir = process.env.XDG_RUNTIME_DIR ?? tmpdir()
	return join(runtimeDir, 'stream-scrapper.sock')
}
