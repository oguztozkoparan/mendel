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
