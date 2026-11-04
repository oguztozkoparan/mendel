import { fetch, hasLocalChanges, pull, push, rebaseOntoUpstream, syncState } from '../git/sync'
import { repoRoot } from '../repos'
import { getSettings } from '../settings'
import { confirm } from './branch'
import type { Handlers } from '.'

let running: AbortController | null = null

/** One network op at a time; `sync:cancel` kills it. */
async function exclusive<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (running) throw new Error('Another sync operation is running')
  running = new AbortController()
  try {
    return await fn(running.signal)
  } finally {
    running = null
  }
}

export const syncHandlers: Handlers<'sync:state' | 'sync:fetch' | 'sync:pull' | 'sync:push' | 'sync:rebase' | 'sync:cancel'> = {
  'sync:state': ({ repo }) => syncState(repoRoot(repo)),
  'sync:fetch': ({ repo, auto }) => {
    if (auto && running) return
    return exclusive((signal) => fetch(repoRoot(repo), { signal, noPrompt: auto }))
  },
  'sync:pull': ({ repo }) => exclusive((signal) => pull(repoRoot(repo), getSettings().pullStrategy === 'rebase', { signal })),
  'sync:push': ({ repo }) => exclusive((signal) => push(repoRoot(repo), { signal })),
  'sync:rebase': async ({ repo }, e) => {
    const root = repoRoot(repo)
    const dirty = await hasLocalChanges(root)
    if (dirty && !(await confirm(e, 'Stash & rebase', 'You have uncommitted changes.', 'They are stashed before the rebase and restored after it.'))) return null
    return exclusive((signal) => rebaseOntoUpstream(root, dirty, { signal }))
  },
  'sync:cancel': () => running?.abort()
}
