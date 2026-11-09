import { appendFileSync, lstatSync, readFileSync } from 'node:fs'
import type { FileChange, StatusCode } from '../../shared/ipc'
import { realUnder, resolveUnder } from '../safe-path'
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
  // --no-index reads the file outside git's path handling: a symlinked parent dir could point out of the repo (S6).
  if (t.untracked && !(await realUnder(cwd, t.path))) throw new Error('Invalid path')
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

const NO_EOL = '\\ No newline at end of file'

/**
 * `hunkPatch` cut down to the picked change lines (indexes into the hunk's lines, `\` markers not counted).
 * The fixed side (old for stage; new for unstage, which is applied with --reverse) must keep matching the file:
 * unpicked fixed-side lines become context, unpicked other-side lines are dropped. null if the hunk is gone or nothing changes,
 * or if `texts` (the picked lines as the user saw them, sign included) no longer match those lines.
 */
export function linesPatch(diff: string, header: string, picked: number[], reverse: boolean, texts?: string[]): string | null {
  const patch = hunkPatch(diff, header)
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(header)
  if (!patch || !m) return null
  const lines = patch.slice(0, -1).split('\n')
  const at = lines.indexOf(header)
  const body = lines.slice(at + 1).map((text) => ({ text, eol: true }))
  for (let i = body.length - 1; i > 0; i--) if (body[i]!.text === NO_EOL) ((body[i - 1]!.eol = false), body.splice(i, 1))
  const fixed = reverse ? '+' : '-'
  const want = new Set(picked)
  if (texts && picked.some((p, k) => body[p]?.text !== texts[k])) return null
  if (!body.some((l, i) => want.has(i) && l.text[0] !== ' ')) return null
  // Per run of changed lines: fixed-side lines keep their order; picked other-side lines go after the last picked
  // fixed line (stage) or before the first (unstage), so a partly picked replacement lands where it was.
  // A no-newline picked line is its side's last line, so the picked lines then go after the whole run.
  const kept: typeof body = []
  for (let i = 0; i < body.length; ) {
    if (body[i]!.text[0] === ' ') {
      kept.push(body[i++]!)
      continue
    }
    const fix: typeof body = []
    const moving: typeof body = []
    for (; i < body.length && body[i]!.text[0] !== ' '; i++) {
      const l = body[i]!
      if (l.text[0] === fixed) fix.push(want.has(i) ? l : { text: ' ' + l.text.slice(1), eol: l.eol })
      else if (want.has(i)) moving.push(l)
    }
    const last = fix.map((l) => l.text[0]).lastIndexOf(fixed)
    const pos = moving.some((l) => !l.eol) ? fix.length : reverse ? fix.findIndex((l) => l.text[0] === fixed) : last < 0 ? fix.length : last + 1
    kept.push(...fix.slice(0, Math.max(pos, 0)), ...moving, ...fix.slice(Math.max(pos, 0)))
  }
  const out: string[] = []
  let oldN = 0
  let newN = 0
  kept.forEach((l, i) => {
    const sign = l.text[0]
    // A no-newline fixed-side line kept as context but followed by result-side lines must gain its newline there.
    if (sign === ' ' && !l.eol && kept.slice(i + 1).some((k) => k.text[0] !== fixed)) {
      out.push(fixed + l.text.slice(1), NO_EOL, (reverse ? '-' : '+') + l.text.slice(1))
      return void (oldN++, newN++)
    }
    out.push(l.text, ...(l.eol ? [] : [NO_EOL]))
    if (sign !== '+') oldN++
    if (sign !== '-') newN++
  })
  // An added (deleted) file that keeps lines on its empty side becomes a modification of that path.
  const name = (side: string, prefix: string) => lines.find((h) => h.startsWith(side))!.slice(4).replace(/^("?)[ab]\//, `$1${prefix}/`)
  const head = lines
    .slice(0, at)
    .filter((h) => !((oldN && h.startsWith('new file mode')) || (newN && h.startsWith('deleted file mode'))))
    .map((h) => (oldN && h === '--- /dev/null' ? '--- ' + name('+++ ', 'a') : newN && h === '+++ /dev/null' ? '+++ ' + name('--- ', 'b') : h))
  const start = (s: string, n: number) => (n && s === '0' ? '1' : s)
  return [...head, `@@ -${start(m[1]!, oldN)},${oldN} +${start(m[2]!, newN)},${newN} @@${m[3]}`, ...out].join('\n') + '\n'
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
 * discard = unstaged hunk reversed out of the working tree. `lines`/`texts` = only these change lines of the hunk (see linesPatch).
 */
export async function applyHunk(
  cwd: string,
  t: Omit<DiffTarget, 'staged'>,
  header: string,
  action: HunkAction,
  env?: NodeJS.ProcessEnv,
  lines?: number[],
  texts?: string[]
): Promise<void> {
  const staged = action === 'unstage'
  const diff = await getDiff(cwd, { ...t, staged, untracked: t.untracked && !staged }, env)
  const patch = lines ? linesPatch(diff, header, lines, action !== 'stage', texts) : hunkPatch(diff, header)
  if (!patch) throw new Error('The file changed since the diff was shown; try again')
  const args = ['apply', '--whitespace=nowarn', ...(action === 'discard' ? [] : ['--cached']), ...(action === 'stage' ? [] : ['--reverse']), '-']
  await git(args, { cwd, env, stdin: patch })
}

/** `.gitignore` pattern matching exactly repo-relative `rel`: anchored with `/`, glob chars and trailing spaces escaped. */
export function ignorePattern(rel: string): string {
  if (/[\r\n\0]/.test(rel)) throw new Error('This file name cannot be written to .gitignore')
  return '/' + rel.replace(/[\\*?[]/g, '\\$&').replace(/ +$/, (sp) => sp.replace(/ /g, '\\ '))
}

/** Append `rel`'s exact pattern to the repo root's `.gitignore` (created if missing; a symlinked one is refused). */
export function ignorePath(root: string, rel: string): void {
  const file = resolveUnder(root, '.gitignore')!
  let text = ''
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error('.gitignore is a symbolic link; edit it yourself')
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + ignorePattern(rel) + '\n')
}
