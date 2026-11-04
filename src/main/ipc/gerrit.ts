import { net, shell } from 'electron'
import { GERRIT_AUTH_ERROR } from '../../shared/gerrit'
import log from '../log'
import { gerritClient, normalizeBaseUrl, type Fetch } from '../providers/gerrit/client'
import { getCredential, removeCredential, saveCredential } from '../providers/gerrit/credentials'
import { activeState, allowLoopbackHttp, providerHandlers } from './provider'
import type { Handlers } from '.'

// net.fetch: Chromium network stack (OS cert store, system proxy); TLS errors are never overridden (TECH.md §6.6).
const fetchFn: Fetch = (url, init) => net.fetch(url, init)
const hostOf = (baseUrl: string) => new URL(baseUrl).host

/** Active Gerrit base URL of a repo (from main's detection; the renderer never supplies it). */
async function baseOf(repo: string): Promise<string> {
  const d = (await activeState(repo)).detection
  if (d?.provider !== 'gerrit') throw new Error('Gerrit is not active for this repository')
  if (!d.baseUrl) throw new Error('Gerrit URL is not set')
  return d.baseUrl
}

/** Authenticated client for a repo; throws GERRIT_AUTH_ERROR when no credential is stored. */
export async function gerritFor(repo: string) {
  const base = await baseOf(repo)
  const auth = await getCredential(hostOf(base))
  if (!auth) throw new Error(GERRIT_AUTH_ERROR)
  return gerritClient(base, auth, fetchFn)
}

export const gerritHandlers: Handlers<'gerrit:connect' | 'gerrit:disconnect' | 'gerrit:open'> = {
  'gerrit:connect': async ({ repo, baseUrl, username, password }, e) => {
    const d = (await activeState(repo)).detection
    if (d?.provider !== 'gerrit') throw new Error('Gerrit is not active for this repository')
    const base = normalizeBaseUrl(baseUrl, allowLoopbackHttp)
    const me = await gerritClient(base, { username, password }, fetchFn).self() // 401: nothing is stored
    const persisted = await saveCredential(hostOf(base), { username, password })
    if (base !== d.baseUrl) await providerHandlers['provider:setOverride']({ repo, provider: 'gerrit', baseUrl: base }, e)
    return { name: me.name ?? me.username ?? username, email: me.email ?? '', persisted }
  },
  'gerrit:disconnect': async ({ repo }) => removeCredential(hostOf(await baseOf(repo))),
  /** Open a page of the configured Gerrit in the browser; anything off that origin is dropped (TECH.md §6.1). */
  'gerrit:open': async ({ repo, path }) => {
    const base = await baseOf(repo)
    let u: URL | null = null
    try {
      u = new URL(path, base + '/')
    } catch {
      /* invalid: blocked below */
    }
    if (!u || u.origin !== new URL(base).origin || u.username || u.password) return log.warn('[gerrit] blocked external url')
    await shell.openExternal(u.href)
  }
}
