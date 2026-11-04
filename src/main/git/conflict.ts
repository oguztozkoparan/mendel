import { existsSync } from 'node:fs'
import path from 'node:path'
import type { OpInProgress, SyncResult } from '../../shared/ipc'
import { git } from './runner'
import { conflictAware } from './sync'

/** Merge or rebase stopped mid-way (MERGE_HEAD / rebase-merge / rebase-apply in the git dir), else null. */
export async function opInProgress(cwd: string, env?: NodeJS.ProcessEnv): Promise<OpInProgress> {
  const { stdout } = await git(['rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], { cwd, env, background: true })
  const [merge = '', rebaseMerge = '', rebaseApply = ''] = stdout.split('\n').map((p) => path.resolve(cwd, p.trim()))
  return existsSync(rebaseMerge) || existsSync(rebaseApply) ? 'rebase' : existsSync(merge) ? 'merge' : null
}

const unmerged = (cwd: string, env?: NodeJS.ProcessEnv) => git(['ls-files', '--unmerged'], { cwd, env }).then((r) => r.stdout.trim() !== '')

/** `merge --continue` / `rebase --continue` without an editor (GIT_EDITOR=true keeps git's message). 'conflict' = the next commit conflicts. */
export async function continueOp(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncResult> {
  const op = await opInProgress(cwd, env)
  if (!op) throw new Error('No merge or rebase in progress')
  if (await unmerged(cwd, env)) throw new Error('Mark all conflicted files as resolved first')
  return conflictAware(cwd, git([op, '--continue'], { cwd, env: { ...env, GIT_EDITOR: 'true' } }), env)
}

/** `merge --abort` / `rebase --abort`: back to the pre-operation HEAD. */
export async function abortOp(cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const op = await opInProgress(cwd, env)
  if (!op) throw new Error('No merge or rebase in progress')
  await git([op, '--abort'], { cwd, env })
}
