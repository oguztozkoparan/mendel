import { abortOp, continueOp, opInProgress } from '../git/conflict'
import { repoRoot } from '../repos'
import { confirm } from './branch'
import type { Handlers } from '.'

export const conflictHandlers: Handlers<'conflict:state' | 'conflict:continue' | 'conflict:abort'> = {
  'conflict:state': ({ repo }) => opInProgress(repoRoot(repo)),
  'conflict:continue': ({ repo }) => continueOp(repoRoot(repo)),
  'conflict:abort': async ({ repo }, e) => {
    const root = repoRoot(repo)
    const op = await opInProgress(root)
    if (!(await confirm(e, `Abort ${op ?? ''}`.trim(), `Abort the ${op ?? 'operation'}?`, 'Your branch goes back to where it was before; conflict resolutions are lost.'))) return false
    await abortOp(root)
    return true
  }
}
