import type { CommitInfo } from '../../shared/ipc'
import { git } from './runner'

export async function commitInfo(cwd: string, env?: NodeJS.ProcessEnv): Promise<CommitInfo> {
  const out = (args: string[]) => git(args, { cwd, env, background: true }).then((r) => r.stdout, () => null)
  const [branch, ident, head] = await Promise.all([
    out(['branch', '--show-current']),
    out(['var', 'GIT_AUTHOR_IDENT']),
    out(['log', '-1', '--format=%B'])
  ])
  return {
    branch: branch?.trim() || null,
    author: ident?.trim().replace(/ \d+ [+-]\d{4}$/, '') || null,
    head: head === null ? null : head.replace(/\n+$/, '')
  }
}

/** `summary\n\ndescription\n` (description optional). */
export function formatMessage(summary: string, description: string): string {
  const d = description.replace(/^\s*\n/, '').trimEnd()
  return summary.trim() + (d ? `\n\n${d}` : '') + '\n'
}

/**
 * Hook point for a provider to rewrite the message right before committing (PLAN.md §4.6, e.g. a Gerrit
 * Change-Id trailer). One at a time; the provider registry (item 18) decides who sets it.
 */
export type CommitMessageTransform = (message: string, ctx: { cwd: string; amend: boolean }) => Promise<string>
let transform: CommitMessageTransform | null = null
export function setCommitMessageTransform(t: CommitMessageTransform | null): void {
  transform = t
}

/** `git commit -F -` (message via stdin, TECH.md §6.3); hooks run like in the terminal. */
export async function commit(cwd: string, c: { summary: string; description: string; amend: boolean }, env?: NodeJS.ProcessEnv): Promise<void> {
  let message = formatMessage(c.summary, c.description)
  if (transform) message = await transform(message, { cwd, amend: c.amend })
  await git(['commit', '-F', '-', ...(c.amend ? ['--amend'] : [])], { cwd, env, stdin: message })
}
