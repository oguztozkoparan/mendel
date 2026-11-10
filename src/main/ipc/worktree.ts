import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { repoTopLevel } from '../git/repo'
import { addWorktree, knownWorktree, listWorktrees, pruneWorktrees, removeWorktree } from '../git/worktree'
import { forgetPath, rememberRepo, repoRoot } from '../repos'
import { confirm } from './branch'
import { childDir, topLevelTrusting } from './repo'
import type { Handlers } from '.'

/** Parent folder picked in the new-worktree dialog, per repo id, for this session. */
const picked = new Map<string, string>()

/** Picked parent, else the folder holding the main worktree. */
async function parentOf(repo: string): Promise<string> {
  const p = picked.get(repo)
  if (p) return p
  const root = repoRoot(repo)
  const main = (await listWorktrees(root).catch(() => [])).find((w) => w.main)?.path ?? root
  return path.dirname(path.resolve(main))
}

export const worktreeHandlers: Handlers<'worktree:list' | 'worktree:parent' | 'worktree:add' | 'worktree:open' | 'worktree:remove' | 'worktree:prune'> = {
  'worktree:list': ({ repo }) => listWorktrees(repoRoot(repo)),
  'worktree:parent': async ({ repo, pick }, e) => {
    const current = await parentOf(repo)
    if (!pick) return current
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory', 'createDirectory'], defaultPath: current })
    if (r.canceled || !r.filePaths[0]) return current
    picked.set(repo, r.filePaths[0])
    return r.filePaths[0]
  },
  'worktree:add': async ({ repo, branch, create, base, folder, open }) => {
    const root = repoRoot(repo)
    const dest = childDir(await parentOf(repo), folder)
    if (!dest) throw new Error('Invalid folder name')
    await addWorktree(root, dest, { branch, create, base })
    return open ? rememberRepo(await repoTopLevel(dest)) : null
  },
  'worktree:open': async ({ repo, path: p }, e) => {
    const w = await knownWorktree(repoRoot(repo), p)
    if (w.prunable) throw new Error(`Worktree folder is missing: ${w.path}`)
    return rememberRepo(await topLevelTrusting(path.resolve(w.path), BrowserWindow.fromWebContents(e.sender)))
  },
  'worktree:remove': async ({ repo, path: p }, e) => {
    const root = repoRoot(repo)
    const w = await knownWorktree(root, p)
    const kept = w.branch ? ` Branch ${w.branch} is kept.` : ''
    if (!(await confirm(e, 'Remove', `Remove worktree ${w.path}?`, `Its folder is deleted.${kept}`))) return false
    if ((await removeWorktree(root, w.path, false)) === 'dirty') {
      if (!(await confirm(e, 'Remove anyway', `Worktree ${w.path} has uncommitted changes.`, 'They will be lost.'))) return false
      await removeWorktree(root, w.path, true)
    }
    forgetPath(w.path)
    return true
  },
  'worktree:prune': ({ repo }) => pruneWorktrees(repoRoot(repo))
}
