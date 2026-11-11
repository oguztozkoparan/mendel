import { net, shell } from 'electron'
import { GERRIT_AUTH_ERROR, GERRIT_REBASE_CONFLICT, type GerritChange, type GerritDraft } from '../../shared/gerrit'
import log from '../log'
import { gerritClient, GerritHttpError, normalizeBaseUrl } from '../providers/gerrit/client'
import { getCredential, removeCredential, saveCredential } from '../providers/credentials'
import { hostOf, type Fetch } from '../providers/http'
import { validateBranchName } from '../git/branch'
import { addChangeId, amendWithChangeId, checkoutChange, hasCommitMsgHook, sendForReview, unpushedCommits, upstreamBranch } from '../providers/gerrit/git'
import { setCommitMessageTransform } from '../git/commit'
import { repoRoot } from '../repos'
import { confirm } from './branch'
import { activeState, activeStates, allowLoopbackHttp, providerHandlers } from './provider'
import { exclusive } from './sync'
import type { Handlers } from '.'

// net.fetch: Chromium network stack (OS cert store, system proxy); TLS errors are never overridden (TECH.md §6.6).
const fetchFn: Fetch = (url, init) => net.fetch(url, init)

/** Active Gerrit base URL of a repo (from main's detection; the renderer never supplies it). */
export async function baseOf(repo: string): Promise<string> {
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

/** Root of a repo whose active provider is Gerrit (git-side features need no base URL). */
async function gerritRoot(repo: string): Promise<{ root: string; remote: string }> {
  const d = (await activeState(repo)).detection
  if (d?.provider !== 'gerrit') throw new Error('Gerrit is not active for this repository')
  return { root: repoRoot(repo), remote: d.remote }
}

// PLAN.md §4.6: Change-Id trailer for commits in Gerrit repos (no-op when a commit-msg hook exists).
setCommitMessageTransform(async (message, { cwd, amend }) => {
  for (const [repo, s] of activeStates()) {
    if (s.detection?.provider !== 'gerrit') continue
    let root = null
    try {
      root = repoRoot(repo)
    } catch {
      /* repo removed */
    }
    if (root === cwd) return addChangeId(cwd, message, amend)
  }
  return message
})

/** Open changes by Change-Id in this project; empty when REST is unavailable (no URL / credentials): hints only. */
async function openByChangeId(repo: string, ids: (string | null)[]): Promise<Map<string, GerritChange>> {
  const wanted = [...new Set(ids.filter((i) => i !== null))].slice(0, 100) // shortcut: first 100 Change-Ids; one query, URL stays short
  if (!wanted.length) return new Map()
  try {
    const list = await (await gerritFor(repo)).openChanges(wanted, (await activeState(repo)).detection?.project || null)
    return new Map(list.map((c) => [c.change_id, c]))
  } catch (err) {
    log.warn('[gerrit] change lookup failed', err instanceof Error ? err.message : err)
    return new Map()
  }
}

export const gerritHandlers: Handlers<'gerrit:checkout' | 'gerrit:badges' | 'gerrit:pending' | 'gerrit:send' | 'gerrit:commitHint' | 'gerrit:addChangeId' | 'gerrit:connect' | 'gerrit:disconnect' | 'gerrit:open' | 'gerrit:changes' | 'gerrit:search' | 'gerrit:change' | 'gerrit:files' | 'gerrit:diff' | 'gerrit:comments' | 'gerrit:self' | 'gerrit:related' | 'gerrit:review' | 'gerrit:action' | 'gerrit:attention' | 'gerrit:hashtags'> = {
  'gerrit:commitHint': async ({ repo }) => {
    const { root } = await gerritRoot(repo)
    const [hook, commits] = await Promise.all([hasCommitMsgHook(root), unpushedCommits(root)])
    const head = commits[0] // HEAD when anything is unpushed
    const open = await openByChangeId(repo, [head?.changeId ?? null])
    return { hook, headMissingChangeId: !!head && !head.changeId, patchsetOf: open.get(head?.changeId ?? '')?._number ?? null }
  },
  'gerrit:addChangeId': async ({ repo }) => amendWithChangeId((await gerritRoot(repo)).root),
  'gerrit:pending': async ({ repo }) => {
    const { root } = await gerritRoot(repo)
    const [target, commits] = await Promise.all([upstreamBranch(root), unpushedCommits(root)])
    const c = (await openByChangeId(repo, [commits[0]?.changeId ?? null])).get(commits[0]?.changeId ?? '')
    return { target, commits, headChange: c ? { number: c._number, wip: !!c.work_in_progress } : null }
  },
  'gerrit:checkout': async ({ repo, change, patchSet, branch }, e) => {
    const { root, remote } = await gerritRoot(repo)
    const upstream = `${remote}/${await validateBranchName(root, branch)}`
    const ask = (q: 'replace' | 'stash') =>
      q === 'replace'
        ? confirm(e, 'Replace', `Branch change/${change}-ps${patchSet} already exists.`, 'Reset it to the fetched patch set?')
        : confirm(e, 'Stash & switch', 'Your local changes would be overwritten by the checkout.', 'Stash them now and restore them when you come back to this branch.')
    return exclusive((signal) => checkoutChange(root, remote, change, patchSet, upstream, ask, undefined, signal))
  },
  'gerrit:badges': async ({ repo }) => {
    const commits = await unpushedCommits((await gerritRoot(repo)).root)
    const open = await openByChangeId(repo, commits.map((c) => c.changeId))
    return Object.fromEntries(commits.flatMap((c) => (c.changeId && open.has(c.changeId) ? [[c.sha, open.get(c.changeId)!._number]] : [])))
  },
  'gerrit:send': async ({ repo, ...o }) => {
    const { root, remote } = await gerritRoot(repo)
    return exclusive((signal) => sendForReview(root, remote, o, { signal }))
  },
  'gerrit:change': async ({ repo, change }) => (await gerritFor(repo)).change(change),
  'gerrit:files': async ({ repo, change, revision, base }) => (await gerritFor(repo)).files(change, revision, base),
  'gerrit:comments': async ({ repo, change }) => (await gerritFor(repo)).comments(change),
  'gerrit:self': async ({ repo }) => (await (await gerritFor(repo)).self())._account_id ?? null,
  'gerrit:related': async ({ repo, change }) => (await gerritFor(repo)).related(change),
  'gerrit:review': async ({ repo, change, patchSet, message, labels, comments }) => {
    const client = await gerritFor(repo)
    const toInput = (ds: GerritDraft[]) => {
      const out: Record<string, Omit<GerritDraft, 'path' | 'patch_set'>[]> = {}
      for (const { path, patch_set: _ps, ...c } of ds) (out[path] ??= []).push(c)
      return out
    }
    // Replies to threads on older patch sets must be posted there (comments only, first); message + votes on the
    // current patch set last. The reply dialog sends one patch set per call so it can drop drafts per success.
    for (const ps of new Set(comments.map((c) => c.patch_set).filter((p) => p !== patchSet)))
      await client.review(change, ps, { comments: toInput(comments.filter((c) => c.patch_set === ps)) })
    await client.review(change, patchSet, { message: message || undefined, labels, comments: toInput(comments.filter((c) => c.patch_set === patchSet)) })
  },
  'gerrit:action': async ({ repo, change, action, message }) => {
    try {
      await (await gerritFor(repo)).action(change, action, message || undefined)
    } catch (err) {
      if (action === 'rebase' && err instanceof GerritHttpError && err.status === 409) throw new Error(GERRIT_REBASE_CONFLICT)
      throw err
    }
  },
  'gerrit:attention': async ({ repo, change, account, add }) => {
    await (await gerritFor(repo)).attention(change, account, add, add ? 'Added in Mendel' : 'Removed in Mendel')
  },
  'gerrit:hashtags': async ({ repo, change, add, remove }) => (await gerritFor(repo)).hashtags(change, add, remove),
  'gerrit:diff': async ({ repo, change, revision, path, base }) => (await gerritFor(repo)).diff(change, revision, path, base),
  'gerrit:changes': async ({ repo, projectOnly }) => {
    const client = await gerritFor(repo)
    return client.listChanges(projectOnly ? (await activeState(repo)).detection?.project || null : null)
  },
  'gerrit:search': async ({ repo, projectOnly, query, start }) => {
    const client = await gerritFor(repo)
    return client.search(query, projectOnly ? (await activeState(repo)).detection?.project || null : null, start)
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
