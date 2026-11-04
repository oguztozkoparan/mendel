import { getDiff, getStatus } from '../git/changes'
import { repoRoot } from '../repos'
import { resolveUnder } from '../safe-path'
import { watchRepo } from '../watch'
import { emit, type Handlers } from '.'

/** Repo-relative path from the renderer, rejected if it escapes the repo (TECH.md §6.4). */
export function checkPath(root: string, rel: string): string {
  if (!resolveUnder(root, rel)) throw new Error('Invalid path')
  return rel
}

export const changesHandlers: Handlers<'changes:status' | 'changes:diff'> = {
  'changes:status': ({ repo }) => {
    const root = repoRoot(repo)
    watchRepo(root, () => emit('repo:changed', { repo }))
    return getStatus(root)
  },
  'changes:diff': ({ repo, path, origPath, staged, untracked }) => {
    const root = repoRoot(repo)
    return getDiff(root, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath), staged, untracked })
  }
}
