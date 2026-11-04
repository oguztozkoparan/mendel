import { BrowserWindow, clipboard, dialog, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import { openInEditor } from '../external'
import { applyHunk, discardPaths, getDiff, getStatus, ignorePath, stagePaths, unstagePaths } from '../git/changes'
import { repoRoot } from '../repos'
import { getSettings } from '../settings'
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
  if (!getSettings().confirmDiscard) return true
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Discard', 'Cancel'], defaultId: 1, cancelId: 1, message, detail: 'This cannot be undone.' })
  return r.response === 0
}

export const changesHandlers: Handlers<'changes:status' | 'changes:diff' | 'changes:stage' | 'changes:unstage' | 'changes:applyHunk' | 'changes:discard' | 'changes:menu'> = {
  'changes:status': ({ repo }) => {
    const root = repoRoot(repo)
    watchRepo(
      root,
      () => emit('repo:changed', { repo }),
      () => emit('repo:watchOff', { repo })
    )
    return getStatus(root)
  },
  'changes:diff': ({ repo, path, origPath, staged, untracked }) => {
    const root = repoRoot(repo)
    return getDiff(root, { path: checkPath(root, path), origPath: origPath && checkPath(root, origPath), staged, untracked })
  },
  'changes:stage': (req) => {
    const root = repoRoot(req.repo)
    return stagePaths(root, 'all' in req ? null : req.paths.map((p) => checkPath(root, p)))
  },
  'changes:unstage': (req) => {
    const root = repoRoot(req.repo)
    return unstagePaths(root, 'all' in req ? null : req.paths.map((p) => checkPath(root, p)))
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
  },
  'changes:menu': ({ repo, path, origPath, untracked }, e) => {
    const root = repoRoot(repo)
    const abs = resolveUnder(root, checkPath(root, path))!
    const paths = origPath ? [checkPath(root, origPath), path] : [path]
    const mac = process.platform === 'darwin'
    return new Promise<void>((resolve, reject) => {
      let picked = false
      // Settles with the picked action's outcome; the menu's close callback alone means "nothing picked".
      const run = (fn: () => unknown) => () => ((picked = true), Promise.resolve().then(fn).then(() => resolve(), reject))
      const menu = Menu.buildFromTemplate([
        {
          id: 'discard',
          label: 'Discard changes…',
          click: run(async () => (await confirmDiscard(e, `Discard all changes to ${path}?`)) && discardPaths(root, paths))
        },
        { id: 'ignore', label: 'Ignore file (add to .gitignore)', enabled: untracked, click: run(() => ignorePath(root, path)) },
        { type: 'separator' },
        { id: 'reveal', label: mac ? 'Reveal in Finder' : 'Show in File Manager', click: run(() => shell.showItemInFolder(abs)) },
        { id: 'editor', label: 'Open in Editor', click: run(() => openInEditor(root, abs)) },
        { type: 'separator' },
        { id: 'copy', label: 'Copy File Path', click: run(() => clipboard.writeText(abs)) },
        { id: 'copyRelative', label: 'Copy Relative File Path', click: run(() => clipboard.writeText(path)) }
      ])
      // Clicks may be dispatched just after the close callback (macOS): give them a moment.
      menu.popup({ window: BrowserWindow.fromWebContents(e.sender)!, callback: () => setTimeout(() => picked || resolve(), 200) })
    })
  }
}
