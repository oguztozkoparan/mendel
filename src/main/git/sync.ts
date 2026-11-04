import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { SyncResult, SyncState } from '../../shared/ipc'
import { listBranches } from './branch'
import { endOfOptions, git, GitError, type GitOptions } from './runner'

type Opts = Pick<GitOptions, 'env' | 'signal' | 'noPrompt'>
const NO_EXT = ['-c', 'protocol.ext.allow=never']

const config = (cwd: string, key: string, env?: NodeJS.ProcessEnv) =>
  git(['config', '--get', key], { cwd, env, background: true }).then((r) => r.stdout.trim() || null, () => null)

export async function syncState(cwd: string, env?: NodeJS.ProcessEnv): Promise<SyncState> {
  const [b, remotes, fetchHead] = await Promise.all([
    listBranches(cwd, env),
    git(['remote'], { cwd, env, background: true }).then((r) => r.stdout.split('\n').filter(Boolean)),
    git(['rev-parse', '--git-path', 'FETCH_HEAD'], { cwd, env, background: true }).then((r) => r.stdout.trim())
  ])
  const cur = b.local.find((x) => x.name === b.current)
  const tracked = b.current ? await config(cwd, `branch.${b.current}.remote`, env) : null
  const remote = (tracked && remotes.includes(tracked) ? tracked : null) ?? (remotes.includes('origin') ? 'origin' : (remotes[0] ?? null))
  const lastFetched = await stat(path.resolve(cwd, fetchHead)).then((s) => s.mtimeMs, () => null)
  return { branch: b.current, upstream: cur?.upstream ?? null, ahead: cur?.ahead ?? 0, behind: cur?.behind ?? 0, remote, lastFetched }
}

async function remoteOf(cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const s = await syncState(cwd, env)
  if (!s.remote) throw new Error('This repository has no remote')
  return s.remote
}

export async function fetch(cwd: string, o: Opts = {}): Promise<void> {
  await git([...NO_EXT, 'fetch', '--prune', ...endOfOptions(await remoteOf(cwd, o.env))], { cwd, ...o })
}

/** Turn a merge/rebase that stopped on conflicts into a result (git prints CONFLICT on stdout); the conflict banner takes over. */
export async function conflictAware(cwd: string, run: Promise<unknown>, env?: NodeJS.ProcessEnv): Promise<SyncResult> {
  try {
    await run
    return 'ok'
  } catch (err) {
    const unmerged = await git(['ls-files', '--unmerged'], { cwd, env }).then((r) => r.stdout.trim(), () => '')
    if (unmerged) return 'conflict'
    throw err
  }
}

/** `git pull` from the upstream; `rebase` picks the strategy (settings / provider). */
export async function pull(cwd: string, rebase: boolean, o: Opts = {}): Promise<SyncResult> {
  const s = await syncState(cwd, o.env)
  if (!s.upstream) throw new Error('The current branch has no upstream to pull from')
  return conflictAware(cwd, git([...NO_EXT, 'pull', '--no-edit', rebase ? '--rebase' : '--no-rebase'], { cwd, ...o }), o.env)
}

/**
 * Push the current branch to its upstream (`HEAD:<merge ref>`), or publish it (`-u`, same name) when it has none.
 * 'rejected' = the remote has commits we don't (non-fast-forward): pull first.
 */
export async function push(cwd: string, o: Opts = {}): Promise<SyncResult> {
  const s = await syncState(cwd, o.env)
  if (!s.branch) throw new Error('Cannot push a detached HEAD')
  const merge = s.upstream && (await config(cwd, `branch.${s.branch}.merge`, o.env))
  const remote = s.upstream ? await config(cwd, `branch.${s.branch}.remote`, o.env) : s.remote
  if (!remote) throw new Error('This repository has no remote')
  const args = merge
    ? [...NO_EXT, 'push', ...endOfOptions(remote, `HEAD:${merge}`)]
    : [...NO_EXT, 'push', '-u', ...endOfOptions(remote, `refs/heads/${s.branch}:refs/heads/${s.branch}`)]
  try {
    await git(args, { cwd, ...o })
    return 'ok'
  } catch (err) {
    if (err instanceof GitError && err.kind === 'PushRejected' && /non-fast-forward|fetch first|\(rejected\)|\[rejected\]/.test(err.stderr)) return 'rejected'
    throw err
  }
}

/** Tracked files with uncommitted changes (rebase refuses to start on them). */
export const hasLocalChanges = (cwd: string, env?: NodeJS.ProcessEnv) =>
  git(['status', '--porcelain', '--untracked-files=no'], { cwd, env, background: true }).then((r) => r.stdout.trim() !== '')

/** PLAN.md 4.8: fetch, then `git rebase @{upstream}`; `autostash` = "Stash & rebase" for a dirty tree. */
export async function rebaseOntoUpstream(cwd: string, autostash: boolean, o: Opts = {}): Promise<SyncResult> {
  const s = await syncState(cwd, o.env)
  if (!s.upstream) throw new Error('The current branch has no upstream to rebase onto')
  await fetch(cwd, o)
  return conflictAware(cwd, git(['rebase', ...(autostash ? ['--autostash'] : []), '@{upstream}'], { cwd, ...o }), o.env)
}
