import type { LiveMetadata, Twitch } from '../twitch'
import type { DetectionSource } from './types.ts'

// Detecção via gql (MVP): a costura fina de troca. Delega pro twitch — que segue
// dono único da comunicação. O HelixDetection implementa a MESMA interface depois
// (com client próprio, auth client-credentials), plugável sem tocar no StreamMonitor.
export class TwitchDetection implements DetectionSource {
	constructor(private readonly twitch: Twitch) {}

	detect(login: string): Promise<LiveMetadata | null> {
		return this.twitch.getLiveMetadata(login)
	}
}
