import type { IpcMainInvokeEvent } from 'electron'
import { fetch, hasLocalChanges, pull, push, rebaseOntoUpstream, syncState } from '../git/sync'
import { repoRoot } from '../repos'
import { getSettings } from '../settings'
import { confirm } from './branch'
import { upstreamBranch } from '../providers/gerrit/git'
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

export const confirmStash = (e: IpcMainInvokeEvent, button: string) =>
  confirm(e, button, 'You have uncommitted changes.', 'They are stashed before the rebase and restored after it.')

export const syncHandlers: Handlers<'sync:state' | 'sync:fetch' | 'sync:pull' | 'sync:push' | 'sync:rebase' | 'sync:cancel'> = {
  'sync:state': ({ repo }) => syncState(repoRoot(repo)),
  'sync:fetch': ({ repo, auto }) => {
    if (auto && running) return
    return exclusive((signal) => fetch(repoRoot(repo), { signal, noPrompt: auto, timeoutMs: auto ? AUTO_FETCH_TIMEOUT_MS : undefined }), auto)
  },
  'sync:pull': async ({ repo }, e) => {
    // Gerrit: always rebase (PLAN.md §5.3), so a merged change's local commit is dropped instead of merged.
    const rebase = (await activeState(repo)).detection?.provider === 'gerrit' || getSettings().pullStrategy === 'rebase'
    const root = repoRoot(repo)
    // `pull --rebase` refuses a dirty tree: same "Stash & …" confirm as sync:rebase.
    const dirty = rebase && (await hasLocalChanges(root))
    if (dirty && !(await confirmStash(e, 'Stash & pull'))) return null
    return exclusive((signal) => pull(root, rebase, { signal }, dirty))
  },
  'sync:push': async ({ repo }, e) => {
    const root = repoRoot(repo)
    // PLAN.md §5.1: Gerrit keeps plain Push, behind a confirm (changes normally go through refs/for/*).
    if ((await activeState(repo)).detection?.provider === 'gerrit') {
      const b = (await upstreamBranch(root)) ?? (await syncState(root)).branch
      if (!(await confirm(e, 'Push', `Push directly to refs/heads/${b}?`, 'This bypasses code review. Use Send for review to upload a change instead.'))) return null
    }
    return exclusive((signal) => push(root, { signal }))
  },
  'sync:rebase': async ({ repo }, e) => {
    const root = repoRoot(repo)
    const dirty = await hasLocalChanges(root)
    if (dirty && !(await confirmStash(e, 'Stash & rebase'))) return null
    return exclusive((signal) => rebaseOntoUpstream(root, dirty, { signal }))
  },
  'sync:cancel': () => running?.ac.abort()
}
