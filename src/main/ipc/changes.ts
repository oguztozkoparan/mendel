import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { applyHunk, discardPaths, getDiff, getStatus, stagePaths, unstagePaths } from '../git/changes'
import { repoRoot } from '../repos'
import { resolveUnder } from '../safe-path'
import { watchRepo } from '../watch'
import { emit, type Handlers } from '.'

/** Repo-relative path from the renderer, rejected if it escapes the repo (TECH.md §6.4). */
export function checkPath(root: string, rel: string): string {
  if (!resolveUnder(root, rel)) throw new Error('Invalid path')
  return rel
}

/** Native confirm for destructive ops (PLAN.md §7), shown by main so the renderer cannot skip it. */
async function confirmDiscard(e: IpcMainInvokeEvent, message: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Discard', 'Cancel'], defaultId: 1, cancelId: 1, message, detail: 'This cannot be undone.' })
  return r.response === 0
}

export const changesHandlers: Handlers<'changes:status' | 'changes:diff' | 'changes:stage' | 'changes:unstage' | 'changes:applyHunk' | 'changes:discard'> = {
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
  'changes:applyHunk': async ({ repo, path, origPath, untracked, hunk, action }, e) => {
    const root = repoRoot(repo)
    if (action === 'discard' && !(await confirmDiscard(e, `Discard this hunk in ${path}?`))) return
    return applyHunk(root, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath), untracked }, hunk, action)
  },
  'changes:discard': async ({ repo, paths }, e) => {
    const root = repoRoot(repo)
    paths.forEach((p) => checkPath(root, p))
    const what = paths.length === 1 ? paths[0] : `${paths.length} files`
    if (!(await confirmDiscard(e, `Discard all changes to ${what}?`))) return false
    await discardPaths(root, paths)
    return true
  }
}
