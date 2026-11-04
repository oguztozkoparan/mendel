import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { applyBranchStash, createBranch, deleteBranch, listBranches, stashAndSwitch, switchBranch } from '../git/branch'
import { repoRoot } from '../repos'
import type { Handlers } from '.'

/** Native message box owned by main (PLAN.md §7), so the renderer cannot skip a confirm. True = first button. */
export async function confirm(e: IpcMainInvokeEvent, button: string, message: string, detail?: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: [button, 'Cancel'], defaultId: 1, cancelId: 1, message, detail })
  return r.response === 0
}

export const branchHandlers: Handlers<'branch:list' | 'branch:create' | 'branch:switch' | 'branch:delete' | 'branch:stash'> = {
  'branch:list': ({ repo }) => listBranches(repoRoot(repo)),
  'branch:create': ({ repo, name, from }) => createBranch(repoRoot(repo), name, from),
  'branch:switch': async ({ repo, name }, e) => {
    const root = repoRoot(repo)
    if ((await switchBranch(root, name)) === 'ok') return true
    const ok = await confirm(e, 'Stash & switch', `Your local changes would be overwritten by switching to ${name}.`, 'Stash them now and restore them when you come back to this branch.')
    if (ok) await stashAndSwitch(root, name)
    return ok
  },
  'branch:delete': async ({ repo, name }, e) => {
    const root = repoRoot(repo)
    if (!(await confirm(e, 'Delete', `Delete branch ${name}?`))) return false
    if ((await deleteBranch(root, name, false)) === 'ok') return true
    if (!(await confirm(e, 'Delete anyway', `Branch ${name} is not fully merged.`, 'Its unmerged commits will be lost.'))) return false
    await deleteBranch(root, name, true)
    return true
  },
  'branch:stash': async ({ repo, action }, e) => {
    if (action === 'discard' && !(await confirm(e, 'Discard', 'Discard the stashed changes?', 'This cannot be undone.'))) return false
    await applyBranchStash(repoRoot(repo), action)
    return true
  }
}
