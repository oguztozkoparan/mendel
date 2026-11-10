import type { HistoryQuery } from '../../shared/historyQuery'
import type { BlameLine, CommitDetail, CommitSummary } from '../../shared/ipc'
import { endOfOptions, git } from './runner'

export const LOG_PAGE = 100
const US = '\x1f'

const hasHead = (cwd: string, env?: NodeJS.ProcessEnv) =>
  git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env, background: true }).then(() => true, () => false)

/** History filters (History search, shared/historyQuery.ts) plus `path` = one file, following renames, and `ref` = full ref name (default HEAD). */
export interface LogFilter extends HistoryQuery {
  ref?: string
}

/** Escape user text for git's extended regex. */
const ere = (s: string) => s.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')

/**
 * git log / rev-list filter args, every value as one `--opt=value` arg (a value starting with '-' cannot become an option).
 * Message text and each trailer are `--grep` patterns, ANDed with `--all-match`; author/committer/dates AND as git does.
 * Without trailers everything is a literal (`--fixed-strings`); a trailer needs a line anchor, so then it is `--extended-regexp`
 * with every user value escaped: `^Reviewed-by:[[:space:]]*.*jane` (Change-Id: prefix, no `.*`). Case-insensitive throughout.
 */
export function logFilterArgs(f: LogFilter): string[] {
  const trailers = f.trailers ?? []
  const lit = trailers.length ? ere : (s: string) => s
  const greps = [...(f.text ? [lit(f.text)] : []), ...trailers.map((t) => `^${ere(t.key)}:[[:space:]]*${t.prefix ? '' : '.*'}${ere(t.value)}`)]
  const match = [...greps.map((g) => `--grep=${g}`), ...(f.author ? [`--author=${lit(f.author)}`] : []), ...(f.committer ? [`--committer=${lit(f.committer)}`] : [])]
  const dates = [...(f.before ? [`--before=${f.before}`] : []), ...(f.after ? [`--after=${f.after}`] : [])]
  if (!match.length) return dates
  return [trailers.length ? '--extended-regexp' : '--fixed-strings', '--regexp-ignore-case', ...(greps.length > 1 ? ['--all-match'] : []), ...match, ...dates]
}

/** One page of the current branch's (or `f.ref`'s) history, newest first; `unpushed` = on no remote-tracking branch. */
export async function getLog(cwd: string, skip: number, env?: NodeJS.ProcessEnv, limit = LOG_PAGE, f: LogFilter = {}): Promise<CommitSummary[]> {
  if (!(await hasHead(cwd, env))) return []
  const o = { cwd, env, background: true }
  let ref = f.ref ?? 'HEAD'
  const filter = logFilterArgs(f)
  // sha: one commit, if the prefix names exactly one commit in this branch's history.
  if (f.sha) {
    if (skip) return []
    // f.sha is validated hex, so it cannot be an option.
    const full = (await git(['rev-parse', '--verify', '-q', `${f.sha}^{commit}`], o).catch(() => null))?.stdout.trim()
    if (!full || !(await git(['merge-base', '--is-ancestor', full, ...endOfOptions(ref)], o).then(() => true, () => false))) return []
    ref = full
  }
  const lit = f.path ? ['--literal-pathspecs'] : []
  const paths = f.path ? [f.path] : []
  // --follow only tracks a rename on commits it walks, and --skip'd commits are not walked: read the skipped part too and drop it below.
  // shortcut: file history page N re-reads N-1 pages, upgrade to a sha cursor if huge single-file histories get slow.
  // sha: --no-walk shows just that commit (git ignores it when -n/--skip are given)
  const page = f.sha ? ['--no-walk'] : f.path ? ['--follow', '-n', String(skip + limit)] : [`--skip=${skip}`, '-n', String(limit)]
  const [log, local] = await Promise.all([
    git([...lit, 'log', '-z', `--format=%H${US}%h${US}%an${US}%at${US}%P${US}%s`, ...filter, ...page, ...endOfOptions(ref), '--', ...paths], o),
    // Same filters so the unpushed set covers this page (rev-list has no --follow; pre-rename commits are rarely local-only).
    // `--end-of-options <ref>` has to be last before `--`: git rejects `--not` after it.
    git([...lit, 'rev-list', ...filter, `--max-count=${skip + limit}`, '--not', '--remotes', '--not', ...endOfOptions(ref), '--', ...paths], o)
  ])
  const unpushed = new Set(local.stdout.split('\n'))
  return log.stdout
    .split('\0')
    .filter(Boolean)
    .slice(f.path ? skip : 0)
    .map((rec) => {
      const [sha = '', short = '', author = '', at = '0', parents = '', summary = ''] = rec.replace(/^\n/, '').split(US)
      return { sha, short, author, date: Number(at) * 1000, parents: parents.split(' ').filter(Boolean), summary, unpushed: unpushed.has(sha) }
    })
}

/** Parse `diff-tree --name-status -z`: status, path (and new path for renames/copies). */
export function parseNameStatus(out: string): CommitDetail['files'] {
  const t = out.split('\0')
  const files: CommitDetail['files'] = []
  for (let i = 0; i < t.length - 1; ) {
    const status = t[i++]![0]!
    if (status === 'R' || status === 'C') files.push({ status, origPath: t[i++]!, path: t[i++]! })
    else files.push({ status, path: t[i++]! })
  }
  return files
}

/** Parse `diff-tree --numstat -z` into +/- counts by (new) path; binary files ("-\t-") get none. */
export function parseNumstat(out: string): Map<string, { add: number; del: number }> {
  const t = out.split('\0')
  const m = new Map<string, { add: number; del: number }>()
  for (let i = 0; i < t.length - 1; ) {
    const [add = '-', del = '-', path = ''] = t[i++]!.split('\t')
    // Renames/copies leave the path empty and follow with old and new path.
    const p = path || (i++, t[i++]!)
    if (add !== '-') m.set(p, { add: Number(add), del: Number(del) })
  }
  return m
}

/** Diff against the first parent (root commits: against the empty tree). */
const treeRange = (d: { sha: string; parents: string[] }) => (d.parents[0] ? endOfOptions(d.parents[0], d.sha) : ['--root', ...endOfOptions(d.sha)])

export async function getCommit(cwd: string, sha: string, env?: NodeJS.ProcessEnv): Promise<CommitDetail> {
  const o = { cwd, env, background: true }
  const { stdout } = await git(['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B', ...endOfOptions(sha)], o)
  const [full = '', parents = '', an = '', ae = '', at = '0', cn = '', ce = '', ct = '0', message = ''] = stdout.split('\0')
  const base = { sha: full, parents: parents.split(' ').filter(Boolean) }
  const [files, num] = await Promise.all(
    ['--name-status', '--numstat'].map((f) => git(['diff-tree', '-r', '-z', '-M', f, '--no-commit-id', ...treeRange(base)], o))
  )
  const counts = parseNumstat(num!.stdout)
  return {
    ...base,
    author: `${an} <${ae}>`,
    authorDate: Number(at) * 1000,
    committer: `${cn} <${ce}>`,
    committerDate: Number(ct) * 1000,
    message: message.replace(/\n+$/, ''),
    files: parseNameStatus(files!.stdout).map((f) => ({ ...f, ...counts.get(f.path) }))
  }
}

/** Read-only unified diff of one file of a commit (same output flags as the Changes diff). */
export async function getCommitDiff(cwd: string, sha: string, file: { path: string; origPath?: string }, env?: NodeJS.ProcessEnv): Promise<string> {
  const [full = '', ...parents] = (await git(['show', '-s', '--format=%H %P', ...endOfOptions(sha)], { cwd, env, background: true })).stdout.trim().split(' ')
  const d = { sha: full, parents }
  const args = ['--literal-pathspecs', '-c', 'core.quotePath=false', 'diff-tree', '-p', '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--no-commit-id']
  return (await git([...args, ...treeRange(d), '--', ...(file.origPath ? [file.origPath] : []), file.path], { cwd, env, background: true })).stdout
}

/** Parse `blame --porcelain`: author fields follow only a commit's first header. */
export function parseBlame(out: string): BlameLine[] {
  const commits = new Map<string, { author: string; date: number }>()
  const lines: BlameLine[] = []
  let c = { author: '', date: 0 }
  let sha = ''
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) lines.push({ sha, author: c.author, date: c.date, text: l.slice(1) })
    else if (/^[0-9a-f]{40,64} \d/.test(l)) {
      sha = l.slice(0, l.indexOf(' '))
      c = commits.get(sha) ?? { author: '', date: 0 }
      commits.set(sha, c)
    } else if (l.startsWith('author ')) c.author = l.slice(7)
    else if (l.startsWith('author-time ')) c.date = Number(l.slice(12)) * 1000
  }
  return lines
}

/** Per-line origin of `path` as of commit `sha`. */
export async function getBlame(cwd: string, sha: string, path: string, env?: NodeJS.ProcessEnv): Promise<BlameLine[]> {
  // blame mis-parses `--end-of-options <rev> -- <path>`; the IPC sha schema (hex only) already rules out a leading '-'.
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error('Invalid commit')
  return parseBlame((await git(['blame', '--porcelain', sha, '--', path], { cwd, env, background: true })).stdout)
}
