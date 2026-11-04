import { fetch, hasLocalChanges, pull, push, rebaseOntoUpstream, syncState } from '../git/sync'
import { repoRoot } from '../repos'
import { getSettings } from '../settings'
import { confirm } from './branch'
import { activeState } from './provider'
import type { Handlers } from '.'

let running: { ac: AbortController; auto: boolean; done: Promise<unknown> } | null = null
const AUTO_FETCH_TIMEOUT_MS = 120_000

/** One network op at a time; `sync:cancel` kills it. A manual op first aborts a running auto-fetch. */
export async function exclusive<T>(fn: (signal: AbortSignal) => Promise<T>, auto = false): Promise<T> {
  if (running?.auto && !auto) {
    running.ac.abort()
    await running.done.catch(() => {})
  }
  if (running) throw new Error('Another sync operation is running')
  const ac = new AbortController()
  const done = fn(ac.signal)
  running = { ac, auto, done }
  try {
    return await done
  } finally {
    if (running?.done === done) running = null
  }
}

export const syncHandlers: Handlers<'sync:state' | 'sync:fetch' | 'sync:pull' | 'sync:push' | 'sync:rebase' | 'sync:cancel'> = {
  'sync:state': ({ repo }) => syncState(repoRoot(repo)),
  'sync:fetch': ({ repo, auto }) => {
    if (auto && running) return
    return exclusive((signal) => fetch(repoRoot(repo), { signal, noPrompt: auto, timeoutMs: auto ? AUTO_FETCH_TIMEOUT_MS : undefined }), auto)
  },
  'sync:pull': async ({ repo }) => {
    // Gerrit: always rebase (PLAN.md §5.3), so a merged change's local commit is dropped instead of merged.
    const rebase = (await activeState(repo)).detection?.provider === 'gerrit' || getSettings().pullStrategy === 'rebase'
    return exclusive((signal) => pull(repoRoot(repo), rebase, { signal }))
  },
  'sync:push': ({ repo }) => exclusive((signal) => push(repoRoot(repo), { signal })),
  'sync:rebase': async ({ repo }, e) => {
    const root = repoRoot(repo)
    const dirty = await hasLocalChanges(root)
    if (dirty && !(await confirm(e, 'Stash & rebase', 'You have uncommitted changes.', 'They are stashed before the rebase and restored after it.'))) return null
    return exclusive((signal) => rebaseOntoUpstream(root, dirty, { signal }))
  },
  'sync:cancel': () => running?.ac.abort()
}
