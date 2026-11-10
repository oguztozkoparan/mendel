import { fullBranchRef } from '../git/branch'
import { opInProgress, pickCommit } from '../git/conflict'
import { getBlame, getCommit, getCommitDiff, getLog } from '../git/log'
import { interactiveRebase } from '../git/rebase'
import { hasLocalChanges } from '../git/sync'
import { unpushedCommits } from '../providers/gerrit/git'
import { repoRoot } from '../repos'
import { checkPath } from './changes'
import { confirmStash, exclusive } from './sync'
import type { Handlers } from '.'

export const historyHandlers: Handlers<'history:log' | 'history:commit' | 'history:diff' | 'history:blame' | 'history:pick' | 'history:unpushed' | 'history:rebase'> = {
  'history:log': async ({ repo, skip, query, path, ref }) => {
    const root = repoRoot(repo)
    // Full ref name: a local branch called like a remote one ("origin/x") stays unambiguous.
    const full = ref && (await fullBranchRef(root, ref))
    const p = path ?? query?.path
    return getLog(root, skip, undefined, undefined, { ...query, path: p && checkPath(root, p), ref: full })
  },
  'history:pick': ({ repo, sha, op }) => pickCommit(repoRoot(repo), op, sha),
  'history:unpushed': async ({ repo }) => (await unpushedCommits(repoRoot(repo))).reverse(),
  'history:rebase': async ({ repo, steps }, e) => {
    const root = repoRoot(repo)
    // Before the stash confirm, so nobody agrees to stash for a rebase that cannot start.
    if (await opInProgress(root)) throw new Error('Finish or abort the operation in progress first')
    const dirty = await hasLocalChanges(root)
    if (dirty && !(await confirmStash(e, 'Stash & rebase'))) return null
    // Same lock as pull/push/sync rebase: two rebases must not race on the index.
    return exclusive(() => interactiveRebase(root, steps, dirty))
  },
  'history:commit': ({ repo, sha }) => getCommit(repoRoot(repo), sha),
  'history:diff': ({ repo, sha, path, origPath }) => {
    const root = repoRoot(repo)
    return getCommitDiff(root, sha, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath) })
  },
  'history:blame': ({ repo, sha, path }) => {
    const root = repoRoot(repo)
    return getBlame(root, sha, checkPath(root, path))
  }
}
