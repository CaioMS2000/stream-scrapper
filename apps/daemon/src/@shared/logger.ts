import { dayjs } from '@/config/date-and-time'

// Wrapper fino sobre console — só pra carimbar cada linha com o horário
// (fuso de `config/date-and-time`, mesmo usado pros paths de storage).
// O daemon roda por horas/dias; sem isso, um erro esporádico no meio dos
// logs (ex.: falha transiente de rede no monitor/vod-linker) não dá pra
// saber quando aconteceu sem cruzar com timestamps do SO.
function timestamp(): string {
	return dayjs().format('YYYY-MM-DD HH:mm:ss')
}

export const logger = {
	log: (...args: unknown[]) => console.log(`[${timestamp()}]`, ...args),
	warn: (...args: unknown[]) => console.warn(`[${timestamp()}]`, ...args),
	error: (...args: unknown[]) => console.error(`[${timestamp()}]`, ...args),
}
