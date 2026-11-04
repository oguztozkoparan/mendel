import { getCommit, getCommitDiff, getLog } from '../git/log'
import { repoRoot } from '../repos'
import { checkPath } from './changes'
import type { Handlers } from '.'

export const historyHandlers: Handlers<'history:log' | 'history:commit' | 'history:diff'> = {
  'history:log': ({ repo, skip }) => getLog(repoRoot(repo), skip),
  'history:commit': ({ repo, sha }) => getCommit(repoRoot(repo), sha),
  'history:diff': ({ repo, sha, path, origPath }) => {
    const root = repoRoot(repo)
    return getCommitDiff(root, sha, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath) })
  }
}
