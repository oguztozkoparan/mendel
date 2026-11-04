// Provider registry (PLAN.md §5). Pure: no electron imports, so detection is unit-tested with a fake probe.
// shortcut: only the members Gerrit uses today (detect); add push/status/badges hooks when a provider needs them.
import type { Detection, ProviderId } from '../../shared/ipc'
import type { Remote } from './remotes'

export type { Detection, ProviderId }

/** Result of an unauthenticated GET; null = network/TLS error or timeout. */
export type ProbeResult = { status: number; body: string } | null
export type Probe = (url: string) => Promise<ProbeResult>

export interface Provider {
  id: ProviderId
  /** First matching remote wins; null = not this provider. Network only through `probe`. */
  detect(remotes: Remote[], probe: Probe): Promise<Detection | null>
}

const registry: Provider[] = []

export function registerProvider(p: Provider): void {
  if (!registry.some((x) => x.id === p.id)) registry.push(p)
}

export function getProvider(id: ProviderId): Provider | undefined {
  return registry.find((p) => p.id === id)
}

/** At most one active provider per repo: the first registered provider that detects one. */
export async function detectProvider(remotes: Remote[], probe: Probe): Promise<Detection | null> {
  for (const p of registry) {
    const d = await p.detect(remotes, probe)
    if (d) return d
  }
  return null
}
