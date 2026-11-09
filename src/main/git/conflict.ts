import { existsSync } from 'node:fs'
import path from 'node:path'
import type { OpInProgress, SyncResult } from '../../shared/ipc'
import { endOfOptions, git } from './runner'
import { conflictAware } from './sync'

/** Op stopped mid-way (rebase-merge / rebase-apply / MERGE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD in the git dir), else null. */
export async function opInProgress(cwd: string, env?: NodeJS.ProcessEnv): Promise<OpInProgress> {
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
  const { stdout } = await git(['rev-parse', ...names.flatMap((n) => ['--git-path', n])], { cwd, env, background: true })
  const [rebaseMerge, rebaseApply, merge, pick, revert] = stdout.split('\n').map((p) => !!p.trim() && existsSync(path.resolve(cwd, p.trim())))
  return rebaseMerge || rebaseApply ? 'rebase' : merge ? 'merge' : pick ? 'cherry-pick' : revert ? 'revert' : null
}

/** `git cherry-pick` / `git revert --no-edit` one commit onto HEAD; a conflict leaves it in progress for the banner. */
export const pickCommit = (cwd: string, op: 'cherry-pick' | 'revert', sha: string, env?: NodeJS.ProcessEnv): Promise<SyncResult> =>
  conflictAware(cwd, git([op, ...(op === 'revert' ? ['--no-edit'] : []), ...endOfOptions(sha)], { cwd, env }), env)

const unmerged = (cwd: string, env?: NodeJS.ProcessEnv) => git(['ls-files', '--unmerged'], { cwd, env }).then((r) => r.stdout.trim() !== '')

/** `<op> --continue` (merge/rebase/cherry-pick/revert) without an editor (GIT_EDITOR=true keeps git's message). 'conflict' = the next commit conflicts. */
export async function continueOp(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncResult> {
  const op = await opInProgress(cwd, env)
  if (!op) throw new Error('No merge, rebase, cherry-pick or revert in progress')
  if (await unmerged(cwd, env)) throw new Error('Mark all conflicted files as resolved first')
  return conflictAware(cwd, git([op, '--continue'], { cwd, env: { ...env, GIT_EDITOR: 'true' } }), env)
}

/** `<op> --abort`: back to the pre-operation HEAD. */
export async function abortOp(cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const op = await opInProgress(cwd, env)
  if (!op) throw new Error('No merge, rebase, cherry-pick or revert in progress')
  await git([op, '--abort'], { cwd, env })
}
