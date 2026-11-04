import { applyHunk, getDiff, getStatus, stagePaths, unstagePaths } from '../git/changes'
import { repoRoot } from '../repos'
import { resolveUnder } from '../safe-path'
import { watchRepo } from '../watch'
import { emit, type Handlers } from '.'

/** Repo-relative path from the renderer, rejected if it escapes the repo (TECH.md §6.4). */
export function checkPath(root: string, rel: string): string {
  if (!resolveUnder(root, rel)) throw new Error('Invalid path')
  return rel
}

export const changesHandlers: Handlers<'changes:status' | 'changes:diff' | 'changes:stage' | 'changes:unstage' | 'changes:applyHunk'> = {
  'changes:status': ({ repo }) => {
    const root = repoRoot(repo)
    watchRepo(root, () => emit('repo:changed', { repo }))
    return getStatus(root)
  },
  'changes:diff': ({ repo, path, origPath, staged, untracked }) => {
    const root = repoRoot(repo)
    return getDiff(root, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath), staged, untracked })
  },
  'changes:stage': ({ repo, paths }) => {
    const root = repoRoot(repo)
    return stagePaths(root, paths.map((p) => checkPath(root, p)))
  },
  'changes:unstage': ({ repo, paths }) => {
    const root = repoRoot(repo)
    return unstagePaths(root, paths.map((p) => checkPath(root, p)))
  },
  'changes:applyHunk': ({ repo, path, origPath, untracked, hunk, action }) => {
    const root = repoRoot(repo)
    return applyHunk(root, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath), untracked }, hunk, action)
  }
}
