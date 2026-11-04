import { commit, commitInfo } from '../git/commit'
import { repoRoot } from '../repos'
import type { Handlers } from '.'

export const commitHandlers: Handlers<'commit:info' | 'commit:create'> = {
  'commit:info': ({ repo }) => commitInfo(repoRoot(repo)),
  'commit:create': ({ repo, ...c }) => commit(repoRoot(repo), c)
}
