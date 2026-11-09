import type { BlameLine, CommitDetail, CommitSummary } from '../../shared/ipc'
import { endOfOptions, git } from './runner'

export const LOG_PAGE = 100
const US = '\x1f'

const hasHead = (cwd: string, env?: NodeJS.ProcessEnv) =>
  git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env, background: true }).then(() => true, () => false)

/** History filters: case-insensitive literal match on message (`grep`) and author (ANDed, as git does); `path` = one file, following renames; `ref` = full ref name (default HEAD). */
export interface LogFilter {
  grep?: string
  author?: string
  path?: string
  ref?: string
}

/** One page of the current branch's (or `f.ref`'s) history, newest first; `unpushed` = on no remote-tracking branch. */
export async function getLog(cwd: string, skip: number, env?: NodeJS.ProcessEnv, limit = LOG_PAGE, f: LogFilter = {}): Promise<CommitSummary[]> {
  if (!(await hasHead(cwd, env))) return []
  const o = { cwd, env, background: true }
  const ref = f.ref ?? 'HEAD'
  // Single `--opt=value` args: a value starting with '-' cannot become an option.
  const match = [...(f.grep ? [`--grep=${f.grep}`] : []), ...(f.author ? [`--author=${f.author}`] : [])]
  const filter = match.length ? ['-i', '-F', ...match] : []
  const lit = f.path ? ['--literal-pathspecs'] : []
  const paths = f.path ? [f.path] : []
  // --follow only tracks a rename on commits it walks, and --skip'd commits are not walked: read the skipped part too and drop it below.
  // shortcut: file history page N re-reads N-1 pages, upgrade to a sha cursor if huge single-file histories get slow.
  const page = f.path ? ['--follow', '-n', String(skip + limit)] : [`--skip=${skip}`, '-n', String(limit)]
  const [log, local] = await Promise.all([
    git([...lit, 'log', '-z', `--format=%H${US}%h${US}%an${US}%at${US}%s`, ...filter, ...page, ...endOfOptions(ref), '--', ...paths], o),
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
      const [sha = '', short = '', author = '', at = '0', summary = ''] = rec.replace(/^\n/, '').split(US)
      return { sha, short, author, date: Number(at) * 1000, summary, unpushed: unpushed.has(sha) }
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

/** Diff against the first parent (root commits: against the empty tree). */
const treeRange = (d: { sha: string; parents: string[] }) => (d.parents[0] ? endOfOptions(d.parents[0], d.sha) : ['--root', ...endOfOptions(d.sha)])

export async function getCommit(cwd: string, sha: string, env?: NodeJS.ProcessEnv): Promise<CommitDetail> {
  const o = { cwd, env, background: true }
  const { stdout } = await git(['show', '-s', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B', ...endOfOptions(sha)], o)
  const [full = '', parents = '', an = '', ae = '', at = '0', cn = '', ce = '', ct = '0', message = ''] = stdout.split('\0')
  const base = { sha: full, parents: parents.split(' ').filter(Boolean) }
  const files = await git(['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', ...treeRange(base)], o)
  return {
    ...base,
    author: `${an} <${ae}>`,
    authorDate: Number(at) * 1000,
    committer: `${cn} <${ce}>`,
    committerDate: Number(ct) * 1000,
    message: message.replace(/\n+$/, ''),
    files: parseNameStatus(files.stdout)
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
