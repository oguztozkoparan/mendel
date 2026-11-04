import { net, shell } from 'electron'
import { GERRIT_AUTH_ERROR, type GerritDraft } from '../../shared/gerrit'
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

export const gerritHandlers: Handlers<'gerrit:connect' | 'gerrit:disconnect' | 'gerrit:open' | 'gerrit:changes' | 'gerrit:change' | 'gerrit:files' | 'gerrit:diff' | 'gerrit:comments' | 'gerrit:review'> = {
  'gerrit:change': async ({ repo, change }) => (await gerritFor(repo)).change(change),
  'gerrit:files': async ({ repo, change, revision, base }) => (await gerritFor(repo)).files(change, revision, base),
  'gerrit:comments': async ({ repo, change }) => (await gerritFor(repo)).comments(change),
  'gerrit:review': async ({ repo, change, patchSet, message, labels, comments }) => {
    const client = await gerritFor(repo)
    const toInput = (ds: GerritDraft[]) => {
      const out: Record<string, Omit<GerritDraft, 'path' | 'patch_set'>[]> = {}
      for (const { path, patch_set: _ps, ...c } of ds) (out[path] ??= []).push(c)
      return out
    }
    // One review call on the current patch set; replies to threads on older patch sets must be posted there.
    // shortcut: if a later per-patch-set call fails the first one already went through; retry may duplicate those comments.
    await client.review(change, patchSet, { message: message || undefined, labels, comments: toInput(comments.filter((c) => c.patch_set === patchSet)) })
    for (const ps of new Set(comments.map((c) => c.patch_set).filter((p) => p !== patchSet)))
      await client.review(change, ps, { comments: toInput(comments.filter((c) => c.patch_set === ps)) })
  },
  'gerrit:diff': async ({ repo, change, revision, path, base }) => (await gerritFor(repo)).diff(change, revision, path, base),
  'gerrit:changes': async ({ repo, projectOnly }) => {
    const client = await gerritFor(repo)
    return client.listChanges(projectOnly ? (await activeState(repo)).detection?.project || null : null)
  },
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
