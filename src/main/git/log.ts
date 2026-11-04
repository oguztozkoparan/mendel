import type { CommitDetail, CommitSummary } from '../../shared/ipc'
import { endOfOptions, git } from './runner'

export const LOG_PAGE = 100
const US = '\x1f'

const hasHead = (cwd: string, env?: NodeJS.ProcessEnv) =>
  git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env, background: true }).then(() => true, () => false)

/** One page of the current branch's history, newest first; `unpushed` = on no remote-tracking branch. */
export async function getLog(cwd: string, skip: number, env?: NodeJS.ProcessEnv, limit = LOG_PAGE): Promise<CommitSummary[]> {
  if (!(await hasHead(cwd, env))) return []
  const o = { cwd, env, background: true }
  const [log, local] = await Promise.all([
    git(['log', '-z', `--format=%H${US}%h${US}%an${US}%at${US}%s`, `--skip=${skip}`, '-n', String(limit), 'HEAD', '--'], o),
    git(['rev-list', `--max-count=${skip + limit}`, 'HEAD', '--not', '--remotes'], o)
  ])
  const unpushed = new Set(local.stdout.split('\n'))
  return log.stdout
    .split('\0')
    .filter(Boolean)
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
