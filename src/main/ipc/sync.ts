import { fetch, pull, push, syncState } from '../git/sync'
import { repoRoot } from '../repos'
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

export const syncHandlers: Handlers<'sync:state' | 'sync:fetch' | 'sync:pull' | 'sync:push' | 'sync:cancel'> = {
  'sync:state': ({ repo }) => syncState(repoRoot(repo)),
  'sync:fetch': ({ repo }) => exclusive((signal) => fetch(repoRoot(repo), { signal })),
  // shortcut: always merge until settings (pull strategy) and providers choose.
  'sync:pull': ({ repo }) => exclusive((signal) => pull(repoRoot(repo), false, { signal })),
  'sync:push': ({ repo }) => exclusive((signal) => push(repoRoot(repo), { signal })),
  'sync:cancel': () => running?.abort()
}
