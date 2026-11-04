// Gerrit git-side operations (PLAN.md §4.6): Change-Id trailer without downloading the server's commit-msg hook
// (TECH.md §6.3). Pure git, no electron: integration-tested with real git.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { git } from '../../git/runner'

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

export interface UnpushedCommit {
  sha: string
  short: string
  subject: string
  changeId: string | null
}

/** Commits on HEAD that are on no remote-tracking branch (what a push to refs/for/* would send), newest first. */
export async function unpushedCommits(cwd: string, env?: NodeJS.ProcessEnv): Promise<UnpushedCommit[]> {
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
