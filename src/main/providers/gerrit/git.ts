// Gerrit git-side operations (PLAN.md §4.6): Change-Id trailer without downloading the server's commit-msg hook
// (TECH.md §6.3). Pure git, no electron: integration-tested with real git.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { reviewRef, type GerritCommit, type GerritSent } from '../../../shared/gerrit'
import { isDirtyError, STASH_MSG, validateBranchName } from '../../git/branch'
import { endOfOptions, git, GitError } from '../../git/runner'

/** `Change-Id: I<40 hex>` in the message's last paragraph (where Gerrit reads it), or null. */
export function changeIdOf(message: string): string | null {
  const last = message.trimEnd().split(/\n[ \t]*\n/).at(-1) ?? ''
  return /^Change-Id: (I[0-9a-f]{40})[ \t]*$/m.exec(last)?.[1] ?? null
}

/** An executable `commit-msg` hook in the hooks dir (`core.hooksPath` respected via `--git-path`). */
export async function hasCommitMsgHook(cwd: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  const p = (await git(['rev-parse', '--git-path', 'hooks/commit-msg'], { cwd, env, background: true })).stdout.trim()
  return access(path.resolve(cwd, p), process.platform === 'win32' ? constants.F_OK : constants.X_OK).then(
    () => true,
    () => false
  )
}

const out = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => git(args, { cwd, env }).then((r) => r.stdout.trim(), () => '')

/**
 * Commit-message transform: with no commit-msg hook, add `Change-Id: I<sha1>` (sha1 over tree, parent, author,
 * committer and message, like Gerrit's hook) via `git interpret-trailers --if-exists doNothing`. Amend reuses
 * HEAD's Change-Id. With a hook, the message is left to the hook.
 */
export async function addChangeId(cwd: string, message: string, amend: boolean, env?: NodeJS.ProcessEnv): Promise<string> {
  if (changeIdOf(message) || (await hasCommitMsgHook(cwd, env))) return message
  let id = amend ? changeIdOf(await out(cwd, ['log', '-1', '--format=%B'], env)) : null
  if (!id) {
    const [tree, parent, author, committer] = await Promise.all(
      [['write-tree'], ['rev-parse', '--verify', '-q', 'HEAD^0'], ['var', 'GIT_AUTHOR_IDENT'], ['var', 'GIT_COMMITTER_IDENT']].map((a) => out(cwd, a, env))
    )
    const input = `tree ${tree}\n${parent ? `parent ${parent}\n` : ''}author ${author}\ncommitter ${committer}\n\n${message}`
    id = 'I' + createHash('sha1').update(input).digest('hex')
  }
  // commentChar \x01: the message is final text (commit -F), so '#' lines are content, not comments to skip.
  return (await git(['-c', 'core.commentChar=\x01', 'interpret-trailers', '--if-exists', 'doNothing', '--trailer', `Change-Id: ${id}`], { cwd, env, stdin: message })).stdout
}

/** Commits on HEAD that are on no remote-tracking branch (what a push to refs/for/* would send), newest first. */
export async function unpushedCommits(cwd: string, env?: NodeJS.ProcessEnv): Promise<GerritCommit[]> {
  const r = await git(['log', '-z', '-n', '100', '--format=%H%x1f%h%x1f%s%x1f%B', 'HEAD', '--not', '--remotes', '--'], { cwd, env, background: true }).catch(() => null)
  return (r?.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    .map((rec) => {
      const [sha = '', short = '', subject = '', body = ''] = rec.replace(/^\n/, '').split('\x1f')
      return { sha, short, subject, changeId: changeIdOf(body) }
    })
}

/** PLAN.md §4.6 step 4: amend only HEAD's message (staged changes stay staged) to add the Change-Id. */
export async function amendWithChangeId(cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const head = (await unpushedCommits(cwd, env))[0] // HEAD itself whenever the list is non-empty
  if (!head) throw new Error('The last commit is already pushed')
  if (head.changeId) return
  const message = await out(cwd, ['log', '-1', '--format=%B'], env)
  // With a commit-msg hook the hook adds it during the amend; otherwise we do.
  await git(['commit', '--amend', '--only', '-F', '-'], { cwd, env, stdin: await addChangeId(cwd, message + '\n', false, env) })
}

/** Branch the current branch tracks on its remote (`main` for origin/main): the default review target. */
export async function upstreamBranch(cwd: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const branch = await out(cwd, ['branch', '--show-current'], env)
  const merge = branch ? await out(cwd, ['config', '--get', `branch.${branch}.merge`], env) : ''
  return merge.startsWith('refs/heads/') ? merge.slice('refs/heads/'.length) : null
}

/** Change URL from Gerrit's push output (`remote:   https://…/c/p/+/1234 subject [NEW]`; 2.x prints no `[NEW]` but "New Changes:"). */
export function parsePushOutput(stderr: string): Omit<GerritSent, 'status'> {
  const url = /^remote:\s+(https?:\/\/\S+)/m.exec(stderr)?.[1] ?? null
  const number = url ? Number(/\/(\d+)\/?$/.exec(url)?.[1]) || null : null
  return { url, number, updated: !!url && !/\[NEW\]|New Changes:/.test(stderr) }
}

/** PLAN.md §4.4: `git push <remote> HEAD:refs/for/<target>%topic=…,r=…,wip` after validating target, options and Change-Ids. */
export async function sendForReview(
  cwd: string,
  remote: string,
  o: { target: string; topic?: string; reviewers: string[]; wip: boolean; ready?: boolean },
  opts: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}
): Promise<GerritSent> {
  const commits = await unpushedCommits(cwd, opts.env)
  if (!commits.length) throw new Error('Nothing to send')
  if (commits.some((c) => !c.changeId)) throw new Error('Every commit sent for review needs a Change-Id')
  const ref = reviewRef(await validateBranchName(cwd, o.target, opts.env), o)
  await git(['check-ref-format', ref], { cwd, env: opts.env }).catch(() => {
    throw new Error(`Invalid review ref: ${ref}`)
  })
  try {
    const r = await git(['-c', 'protocol.ext.allow=never', 'push', ...endOfOptions(remote, `HEAD:${ref}`)], { cwd, ...opts })
    return { status: 'ok', ...parsePushOutput(r.stderr) }
  } catch (err) {
    if (err instanceof GitError && /\(no new changes\)/.test(err.stderr)) return { status: 'no-changes', url: null, number: null, updated: false }
    throw err
  }
}

/**
 * PLAN.md §4.7: fetch `refs/changes/NN/N/P`, switch to `change/N-psP` on it, track `upstream` (e.g. origin/main) when it
 * exists so Send for review targets the change's branch. `ask` confirms replacing the branch / stashing; null = cancelled.
 */
export async function checkoutChange(
  cwd: string,
  remote: string,
  n: number,
  ps: number,
  upstream: string | null,
  ask: (q: 'replace' | 'stash') => Promise<boolean>,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  if (![n, ps].every((x) => Number.isSafeInteger(x) && x > 0)) throw new Error('Invalid change or patch set number')
  const name = `change/${n}-ps${ps}`
  const has = (ref: string) => git(['rev-parse', '--verify', '-q', ref], { cwd, env }).then(() => true, () => false)
  await git(['-c', 'protocol.ext.allow=never', 'fetch', ...endOfOptions(remote, `refs/changes/${String(n % 100).padStart(2, '0')}/${n}/${ps}`)], { cwd, env })
  const sha = (await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd, env })).stdout.trim()
  const exists = await has(`refs/heads/${name}`)
  if (exists && !(await ask('replace'))) return null
  const sw = () => git(['switch', exists ? '-C' : '-c', name, ...endOfOptions(sha)], { cwd, env })
  try {
    await sw()
  } catch (err) {
    if (!isDirtyError(err)) throw err
    if (!(await ask('stash'))) return null
    await git(['stash', 'push', '--include-untracked', '-m', STASH_MSG], { cwd, env })
    await sw()
  }
  if (upstream && (await has(`refs/remotes/${upstream}`))) await git(['branch', `--set-upstream-to=${upstream}`], { cwd, env })
  return name
}
