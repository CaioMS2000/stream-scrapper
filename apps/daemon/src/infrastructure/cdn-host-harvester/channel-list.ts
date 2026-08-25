// Canais de terceiros pra harvesting ativo de hosts — fornecidos
// manualmente (ADR 005: sem descoberta automática de canais que o
// usuário não escolheu monitorar, de propósito — ver
// docs/decisions/005-cdn-vod-recovery-scope.md). Editar esta lista à mão
// quando quiser engordar o pool além do que os canais monitorados já
// oferecem.
export const HARVEST_CHANNEL_NAMES: readonly string[] = []
