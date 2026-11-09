import type { BranchInfo, Branches, StashEntry, SyncResult } from '../../shared/ipc'
import { endOfOptions, git, GitError } from './runner'
import { conflictAware } from './sync'

/** Message of stashes made by "Stash & switch"; git stores the subject as `On <branch>: mendel-stash`. */
export const STASH_MSG = 'mendel-stash'
const STASH_LIST = ['stash', 'list', '--format=%gd%x00%gs']

/** `stash@{n}` of the newest mendel stash made on `branch` in STASH_LIST output, or null. */
const stashOf = (list: string, branch: string): string | null =>
  list.split('\n').map((l) => l.split('\0')).find(([ref, subject]) => ref && subject === `On ${branch}: ${STASH_MSG}`)?.[0] ?? null

/** Stash everything (incl. untracked) tagged for the current branch ("Stash & switch", Gerrit checkout). */
export const stashPush = (cwd: string, env?: NodeJS.ProcessEnv, signal?: AbortSignal) =>
  git(['stash', 'push', '--include-untracked', '-m', STASH_MSG], { cwd, env, signal })

/** `%(upstream:track,nobracket)`: "ahead 1, behind 2" / "gone" / "". */
export function parseTrack(t: string): { ahead: number; behind: number } {
  return { ahead: Number(/ahead (\d+)/.exec(t)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(t)?.[1] ?? 0) }
}

export async function listBranches(cwd: string, env?: NodeJS.ProcessEnv): Promise<Branches> {
  const fmt = '%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(symref)'
  const [refs, head, stash] = await Promise.all([
    git(['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'], { cwd, env, background: true }),
    git(['rev-parse', '--short', 'HEAD'], { cwd, env, background: true }).then((r) => r.stdout.trim(), () => null),
    git(STASH_LIST, { cwd, env, background: true }).then((r) => r.stdout, () => '')
  ])
  const local: BranchInfo[] = []
  const remote: string[] = []
  let current: string | null = null
  for (const line of refs.stdout.split('\n')) {
    const [ref = '', upstream = '', track = '', isHead, symref] = line.split('\0')
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length)
      local.push({ name, upstream: upstream || null, ...parseTrack(track) })
      if (isHead === '*') current = name
    } else if (ref.startsWith('refs/remotes/') && !symref) remote.push(ref.slice('refs/remotes/'.length))
  }
  // An unborn branch (no commits yet) has no ref but is still current.
  if (!current) current = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, env, background: true }).then((r) => r.stdout.trim(), () => '')) || null
  local.sort((a, b) => Number(b.name === current) - Number(a.name === current))
  return { current, head, local, remote, stash: current !== null && stashOf(stash, current) !== null }
}

/** New branch names (TECH.md §6.3): no leading `-`, and `git check-ref-format --branch` must accept it unchanged. */
export async function validateBranchName(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const bad = new Error(`Invalid branch name: ${name}`)
  if (!name || name.startsWith('-') || name.startsWith('@') || /[\0-\x20\x7f]/.test(name)) throw bad
  const out = await git(['check-ref-format', '--branch', name], { cwd, env }).then((r) => r.stdout.trim(), () => null)
  if (out !== name) throw bad
  return name
}

/** Throw unless `name` is an existing local (or, with `remote`, remote-tracking) branch: the renderer only picks from the list. */
async function known(cwd: string, name: string, env?: NodeJS.ProcessEnv, remote = false): Promise<{ kind: 'local' | 'remote'; b: Branches }> {
  const b = await listBranches(cwd, env)
  if (b.local.some((x) => x.name === name)) return { kind: 'local', b }
  if (remote && b.remote.includes(name)) return { kind: 'remote', b }
  throw new Error(`Unknown branch: ${name}`)
}

/** Full ref name of local (preferred) or remote branch `name`; one show-ref each instead of listing every branch. */
export async function fullBranchRef(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<string> {
  for (const ref of [`refs/heads/${name}`, `refs/remotes/${name}`]) {
    if (await git(['show-ref', '--verify', '-q', ref], { cwd, env, background: true }).then(() => true, () => false)) return ref
  }
  throw new Error(`Unknown branch: ${name}`)
}

/** `git switch -c <name> [<from>]`; local changes come along. */
export async function createBranch(cwd: string, name: string, from: string | undefined, env?: NodeJS.ProcessEnv): Promise<void> {
  await validateBranchName(cwd, name, env)
  if (from) await known(cwd, from, env, true)
  await git(['switch', '-c', name, ...(from ? endOfOptions(from) : [])], { cwd, env })
}

export const isDirtyError = (err: unknown) => err instanceof GitError && /would be overwritten by checkout|untracked working tree files would be/.test(err.stderr)

/**
 * Switch to a local branch, or to a remote one (`origin/x` -> local `x`, created tracking it if missing).
 * Plain `git switch` first so non-conflicting changes come along; 'dirty' = git refused because of local changes.
 */
export async function switchBranch(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<'ok' | 'dirty'> {
  const { kind, b } = await known(cwd, name, env, true)
  // shortcut: assumes remote names have no '/', fine for origin/upstream.
  const localName = kind === 'remote' ? name.slice(name.indexOf('/') + 1) : name
  const hasLocal = kind === 'local' || b.local.some((x) => x.name === localName)
  const args = hasLocal ? ['switch', ...endOfOptions(localName)] : ['switch', '-c', await validateBranchName(cwd, localName, env), '--track', ...endOfOptions(name)]
  try {
    await git(args, { cwd, env })
    return 'ok'
  } catch (err) {
    if (isDirtyError(err)) return 'dirty'
    throw err
  }
}

/** Stash everything (incl. untracked) tagged for the current branch, then switch. */
export async function stashAndSwitch(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await known(cwd, name, env, true)
  await stashPush(cwd, env)
  const r = await switchBranch(cwd, name, env)
  if (r === 'dirty') throw new Error('Could not switch branches even after stashing')
}

/** Restore (`pop`) or drop the mendel stash of the current branch. A conflicting pop keeps the stash (git's behavior). */
export async function applyBranchStash(cwd: string, action: 'restore' | 'discard', env?: NodeJS.ProcessEnv): Promise<void> {
  const { current } = await listBranches(cwd, env)
  const ref = current && stashOf((await git(STASH_LIST, { cwd, env })).stdout, current)
  if (!ref) throw new Error('No stashed changes for this branch')
  await git(['stash', action === 'restore' ? 'pop' : 'drop', '--quiet', ref], { cwd, env })
}

/** All stashes, newest first (`stash@{0}`). */
export async function listStashes(cwd: string, env?: NodeJS.ProcessEnv): Promise<StashEntry[]> {
  const { stdout } = await git(['stash', 'list', '--format=%H%x00%gs%x00%ct'], { cwd, env, background: true })
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha = '', message = '', ct = '0'] = l.split('\0')
      return { sha, message, date: Number(ct) * 1000 }
    })
}

/**
 * Apply, pop or drop the stash with commit `sha`; its `stash@{n}` is looked up now, so a shifted list cannot hit the wrong entry.
 * 'conflict' = apply/pop left unmerged files (a conflicting pop keeps the stash); nothing to continue, only files to resolve.
 */
export async function stashAction(cwd: string, sha: string, action: 'apply' | 'pop' | 'drop', env?: NodeJS.ProcessEnv): Promise<SyncResult> {
  const { stdout } = await git(['stash', 'list', '--format=%gd%x00%H'], { cwd, env })
  const ref = stdout.split('\n').map((l) => l.split('\0')).find(([r, h]) => r && h === sha)?.[0]
  if (!ref) throw new Error('Unknown stash')
  return conflictAware(cwd, git(['stash', action, '--quiet', ref], { cwd, env }), env)
}

/** `git branch -d`; with `force` `-D`. 'unmerged' = -d refused because the branch is not fully merged. */
export async function deleteBranch(cwd: string, name: string, force: boolean, env?: NodeJS.ProcessEnv): Promise<'ok' | 'unmerged'> {
  if ((await known(cwd, name, env)).b.current === name) throw new Error('Cannot delete the current branch')
  try {
    await git(['branch', force ? '-D' : '-d', ...endOfOptions(name)], { cwd, env })
    return 'ok'
  } catch (err) {
    if (!force && err instanceof GitError && /not fully merged/.test(err.stderr)) return 'unmerged'
    throw err
  }
}
