import type { FileChange, StatusCode } from '../../shared/ipc'
import { git } from './runner'

const code = (c: string | undefined) => (c && c !== '.' ? (c as StatusCode) : null)

/** Parse `git status --porcelain=v2 -z` (ordinary `1`, rename/copy `2`, unmerged `u`, untracked `?`). */
export function parseStatus(out: string): FileChange[] {
  const parts = out.split('\0')
  const files: FileChange[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const f = p.split(' ')
    if (p.startsWith('? ')) files.push({ path: p.slice(2), staged: null, unstaged: '?', conflicted: false })
    else if (p.startsWith('1 ')) files.push({ path: f.slice(8).join(' '), staged: code(f[1]?.[0]), unstaged: code(f[1]?.[1]), conflicted: false })
    else if (p.startsWith('2 '))
      files.push({ path: f.slice(9).join(' '), origPath: parts[++i], staged: code(f[1]?.[0]), unstaged: code(f[1]?.[1]), conflicted: false })
    else if (p.startsWith('u ')) files.push({ path: f.slice(10).join(' '), staged: null, unstaged: 'U', conflicted: true })
  }
  return files
}

export async function getStatus(cwd: string, env?: NodeJS.ProcessEnv): Promise<FileChange[]> {
  const { stdout } = await git(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--find-renames'], { cwd, env, background: true })
  return parseStatus(stdout)
}

export interface DiffTarget {
  path: string
  origPath?: string
  /** HEAD..index instead of index..worktree. */
  staged: boolean
  untracked: boolean
}

/**
 * Unified diff for one file, independent of user diff config (no color/external diff/textconv, fixed prefixes)
 * so hunks can be fed back to `git apply`. Paths are literal pathspecs after `--`.
 */
export async function getDiff(cwd: string, t: DiffTarget, env?: NodeJS.ProcessEnv): Promise<string> {
  const base = ['--literal-pathspecs', '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/']
  const args = t.untracked
    ? [...base, '--no-index', '--', '/dev/null', t.path]
    : t.staged
      ? [...base, '--cached', '-M', '--', ...(t.origPath ? [t.origPath] : []), t.path]
      : [...base, '--', t.path]
  return (await git(args, { cwd, env, background: true, okExitCodes: t.untracked ? [1] : undefined })).stdout
}

const PATHSPEC_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul']

/** `git add -A` for exactly these paths (pathspecs via stdin: no argv limits, literal, never options); null = whole tree. */
export async function stagePaths(cwd: string, paths: string[] | null, env?: NodeJS.ProcessEnv): Promise<void> {
  if (!paths) return void (await git(['add', '-A'], { cwd, env }))
  await git(['--literal-pathspecs', 'add', '-A', ...PATHSPEC_STDIN], { cwd, env, stdin: paths.join('\0') })
}

/** Index back to HEAD for these paths, null = all (also works before the first commit). */
export async function unstagePaths(cwd: string, paths: string[] | null, env?: NodeJS.ProcessEnv): Promise<void> {
  if (!paths) return void (await git(['reset', '-q'], { cwd, env }))
  await git(['--literal-pathspecs', 'reset', '-q', ...PATHSPEC_STDIN], { cwd, env, stdin: paths.join('\0') })
}

/** File header of `diff` plus only the hunk whose `@@` line equals `header`; null if that hunk is gone. */
export function hunkPatch(diff: string, header: string): string | null {
  const lines = diff.split('\n')
  const first = lines.findIndex((l) => l.startsWith('@@'))
  const start = lines.indexOf(header)
  if (first < 0 || start < first) return null
  const next = lines.findIndex((l, i) => i > start && l.startsWith('@@'))
  const patch = [...lines.slice(0, first), ...lines.slice(start, next < 0 ? undefined : next)].join('\n')
  return patch.endsWith('\n') ? patch : patch + '\n'
}

/**
 * Throw away all changes (index + worktree) to these paths, only through git (TECH.md §6.4):
 * tracked -> `restore` from HEAD (a newly added file is removed), untracked -> `clean`. Paths not changed are ignored.
 */
export async function discardPaths(cwd: string, paths: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  const wanted = new Set(paths)
  const files = (await getStatus(cwd, env)).filter((f) => wanted.has(f.path) || (f.origPath && wanted.has(f.origPath)))
  const untracked = files.filter((f) => f.unstaged === '?').map((f) => f.path)
  const tracked = files.filter((f) => f.unstaged !== '?').flatMap((f) => (f.origPath ? [f.origPath, f.path] : [f.path]))
  const born = await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env, background: true }).then(() => true, () => false)
  if (tracked.length && born)
    await git(['--literal-pathspecs', 'restore', '--source=HEAD', '--staged', '--worktree', ...PATHSPEC_STDIN], { cwd, env, stdin: tracked.join('\0') })
  // No commits yet: nothing to restore from, every tracked file is a staged addition -> unstage, then clean it.
  if (tracked.length && !born) {
    await git(['--literal-pathspecs', 'rm', '--cached', '-f', '-q', ...PATHSPEC_STDIN], { cwd, env, stdin: tracked.join('\0') })
    untracked.push(...tracked)
  }
  // shortcut: clean takes pathspecs on argv only; thousands of untracked files at once could hit argv limits, batch then.
  if (untracked.length) await git(['--literal-pathspecs', 'clean', '-f', '-q', '--', ...untracked], { cwd, env })
}

export type HunkAction = 'stage' | 'unstage' | 'discard'

/**
 * Re-diff the file in main, pick the hunk the user saw (by its `@@` line) and `git apply` it:
 * stage = unstaged hunk -> index; unstage = staged hunk reversed out of the index;
 * discard = unstaged hunk reversed out of the working tree.
 */
export async function applyHunk(cwd: string, t: Omit<DiffTarget, 'staged'>, header: string, action: HunkAction, env?: NodeJS.ProcessEnv): Promise<void> {
  const staged = action === 'unstage'
  const patch = hunkPatch(await getDiff(cwd, { ...t, staged, untracked: t.untracked && !staged }, env), header)
  if (!patch) throw new Error('The file changed since the diff was shown; try again')
  const args = ['apply', '--whitespace=nowarn', ...(action === 'discard' ? [] : ['--cached']), ...(action === 'stage' ? [] : ['--reverse']), '-']
  await git(args, { cwd, env, stdin: patch })
}
