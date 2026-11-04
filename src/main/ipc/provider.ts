import { net } from 'electron'
import type { ProviderState, RepoOverride } from '../../shared/ipc'
import { detectProvider, forgetNegatives, registerProvider, type Probe } from '../providers'
import { credentialUser } from '../providers/gerrit/credentials'
import { normalizeBaseUrl, readCapped } from '../providers/gerrit/client'
import { gerritDetection, gerritProvider, probeGerrit } from '../providers/gerrit/detect'
import { usedRemotes } from '../providers/remotes'
import { providerStore, saveProviderStore } from '../providers/store'
import { repoRoot } from '../repos'
import { testSeams } from '../security'
import type { Handlers } from '.'

registerProvider(gerritProvider)

/** Loopback http base URLs only in dev/e2e builds (S13); TECH.md §6.6. */
export const allowLoopbackHttp = testSeams

/** Unauthenticated GET with a 3 s timeout (PLAN.md §5.2); net.fetch = OS cert store + system proxy. */
const probe: Probe = async (url) => {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(3000) })
    return { status: res.status, body: await readCapped(res, 64 * 1024) }
  } catch {
    return null
  }
}

/** Last detection per repo; REST handlers read the base URL from here, never from the renderer. */
const active = new Map<string, ProviderState>()

export async function providerState(repo: string): Promise<ProviderState> {
  const s = providerStore()
  const override: RepoOverride = s.repos[repo] ?? { provider: 'auto' }
  let detection = null
  if (override.provider !== 'none') {
    const remotes = await usedRemotes(repoRoot(repo))
    const cached = remotes.find((r) => s.hosts[r.host])
    if (override.baseUrl) detection = gerritDetection(remotes[0], override.baseUrl, s.repos[repo]?.version)
    else if (cached) detection = gerritDetection(cached, s.hosts[cached.host].baseUrl, s.hosts[cached.host].version)
    else {
      detection = await detectProvider(remotes, probe)
      if (!detection && override.provider === 'gerrit') detection = gerritDetection(remotes[0], null)
      if (detection?.baseUrl) {
        s.hosts[detection.host] = { baseUrl: detection.baseUrl, version: detection.serverVersion }
        saveProviderStore()
      }
    }
  }
  const state = {
    detection,
    override: { provider: override.provider, ...(override.baseUrl ? { baseUrl: override.baseUrl } : {}) },
    credentialUser: detection?.baseUrl ? credentialUser(new URL(detection.baseUrl).host) : null
  }
  active.set(repo, state)
  return state
}

/** Repo id → last detection, for main-side hooks that only know the repo root (commit message transform). */
export const activeStates = () => active.entries()

export async function activeState(repo: string): Promise<ProviderState> {
  return active.get(repo) ?? providerState(repo)
}

export const providerHandlers: Handlers<'provider:get' | 'provider:setOverride'> = {
  'provider:get': ({ repo }) => providerState(repo),
  'provider:setOverride': async ({ repo, provider, baseUrl }) => {
    repoRoot(repo) // known repos only
    forgetNegatives()
    const s = providerStore()
    if (provider === 'auto' && !baseUrl) delete s.repos[repo]
    else if (!baseUrl || provider === 'none') s.repos[repo] = { provider }
    else {
      const url = normalizeBaseUrl(baseUrl, allowLoopbackHttp)
      const version = await probeGerrit(url, probe)
      if (version === null) throw new Error(`No Gerrit server found at ${url}`)
      s.repos[repo] = { provider: 'gerrit', baseUrl: url, version }
    }
    saveProviderStore()
    return providerState(repo)
  }
}
