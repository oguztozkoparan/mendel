import { getBlame, getCommit, getCommitDiff, getLog } from '../git/log'
import { repoRoot } from '../repos'
import { checkPath } from './changes'
import type { Handlers } from '.'

export const historyHandlers: Handlers<'history:log' | 'history:commit' | 'history:diff' | 'history:blame'> = {
  'history:log': ({ repo, skip, grep, author, path }) => {
    const root = repoRoot(repo)
    return getLog(root, skip, undefined, undefined, { grep, author, path: path && checkPath(root, path) })
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
