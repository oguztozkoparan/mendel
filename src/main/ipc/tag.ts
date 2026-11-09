import { createTag, deleteTag, listTags, pushTag } from '../git/tag'
import { repoRoot } from '../repos'
import { confirm } from './branch'
import { exclusive } from './sync'
import type { Handlers } from '.'

export const tagHandlers: Handlers<'tag:list' | 'tag:create' | 'tag:delete' | 'tag:push'> = {
  'tag:list': ({ repo }) => listTags(repoRoot(repo)),
  'tag:create': ({ repo, name, sha, message }) => createTag(repoRoot(repo), name, sha, message),
  'tag:delete': async ({ repo, name }, e) => {
    const root = repoRoot(repo)
    if (!(await confirm(e, 'Delete', `Delete tag ${name}?`, 'Only the local tag is deleted.'))) return false
    await deleteTag(root, name)
    return true
  },
  'tag:push': ({ repo, name }) => exclusive((signal) => pushTag(repoRoot(repo), name, { signal }))
}
