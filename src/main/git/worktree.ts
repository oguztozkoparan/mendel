import path from 'node:path'
import type { WorktreeInfo } from '../../shared/ipc'
import { fullBranchRef, nativePath, validateBranchName } from './branch'
import { endOfOptions, git, GitError } from './runner'

/** Same folder: git prints `C:/x` on Windows where we hold `C:\x`, and Windows paths are case-insensitive. */
export function samePath(a: string, b: string): boolean {
  const n = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  return n(a) === n(b)
}

/** `git worktree list --porcelain -z` output (git >= 2.36); `root` marks the current one. Bare entries are skipped. */
export function parseWorktrees(out: string, root: string): WorktreeInfo[] {
  const list: WorktreeInfo[] = []
  let w: (WorktreeInfo & { bare?: boolean }) | null = null
  let n = 0 // records seen; the first is the main worktree, even when it is bare (and so skipped)
  for (const field of [...out.split('\0'), '']) {
    if (!field) {
      if (w && !w.bare) list.push(w)
      w = null
      continue
    }
    const sp = field.indexOf(' ')
    const [key, value] = sp < 0 ? [field, ''] : [field.slice(0, sp), field.slice(sp + 1)]
    if (key === 'worktree') w = { path: nativePath(value), branch: null, head: null, main: n++ === 0, current: samePath(value, root), locked: null, prunable: false }
    else if (!w) continue
    else if (key === 'HEAD') w.head = /^0+$/.test(value) ? null : value
    else if (key === 'branch') w.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'locked') w.locked = value
    else if (key === 'prunable') w.prunable = true
    else if (key === 'bare') w.bare = true
  }
  return list
}

export async function listWorktrees(cwd: string, env?: NodeJS.ProcessEnv): Promise<WorktreeInfo[]> {
  const { stdout } = await git(['worktree', 'list', '--porcelain', '-z'], { cwd, env, background: true })
  return parseWorktrees(stdout, cwd)
}

/** The listed worktree at `p` (as `listWorktrees` returned it); throws for any other path (TECH.md §6.2). */
export async function knownWorktree(cwd: string, p: string, env?: NodeJS.ProcessEnv): Promise<WorktreeInfo> {
  const w = (await listWorktrees(cwd, env)).find((x) => x.path === p)
  if (!w) throw new Error('Unknown worktree')
  return w
}

/**
 * `git worktree add` at absolute `dest`: new branch `branch` from `base` (a listed branch; HEAD if unset) when `create`,
 * else existing local branch `branch`, or remote `origin/x` as local `x` tracking it (created if missing, like switch).
 */
export async function addWorktree(cwd: string, dest: string, o: { branch: string; create: boolean; base?: string }, env?: NodeJS.ProcessEnv): Promise<void> {
  if (!path.isAbsolute(dest)) throw new Error('Invalid folder')
  let args: string[]
  if (o.create) {
    // the full ref, so a tag with the same short name can't make git refuse it as ambiguous
    const base = o.base ? await fullBranchRef(cwd, o.base, env) : null
    args = ['-b', await validateBranchName(cwd, o.branch, env), ...endOfOptions(dest, ...(base ? [base] : []))]
  } else if ((await fullBranchRef(cwd, o.branch, env)).startsWith('refs/heads/')) {
    args = endOfOptions(dest, o.branch)
  } else {
    // shortcut: assumes remote names have no '/', fine for origin/upstream (same as switchBranch).
    const local = o.branch.slice(o.branch.indexOf('/') + 1)
    const exists = await fullBranchRef(cwd, local, env).then((r) => r.startsWith('refs/heads/'), () => false)
    args = exists ? endOfOptions(dest, local) : ['-b', await validateBranchName(cwd, local, env), '--track', ...endOfOptions(dest, o.branch)]
  }
  await git(['worktree', 'add', ...args], { cwd, env })
}

/** `git worktree remove`; 'dirty' = git refused because it has changes (retry with `force`). */
export async function removeWorktree(cwd: string, p: string, force: boolean, env?: NodeJS.ProcessEnv): Promise<'ok' | 'dirty'> {
  const w = await knownWorktree(cwd, p, env)
  if (w.main) throw new Error('The main worktree cannot be removed')
  if (w.current) throw new Error('Cannot remove the worktree that is open')
  try {
    await git(['worktree', 'remove', ...(force ? ['--force'] : []), ...endOfOptions(w.path)], { cwd, env })
    return 'ok'
  } catch (err) {
    if (!force && err instanceof GitError && /contains modified or untracked files/.test(err.stderr)) return 'dirty'
    throw err
  }
}

export const pruneWorktrees = (cwd: string, env?: NodeJS.ProcessEnv) => git(['worktree', 'prune'], { cwd, env }).then(() => {})
