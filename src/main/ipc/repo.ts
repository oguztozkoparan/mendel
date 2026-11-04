import { BrowserWindow, dialog, shell } from 'electron'
import { repoTopLevel } from '../git/repo'
import { forgetRepo, listRepos, rememberRepo, repoRoot } from '../repos'
import type { Handlers } from '.'

export const repoHandlers: Handlers<'repo:list' | 'repo:add' | 'repo:open' | 'repo:remove' | 'repo:reveal'> = {
  'repo:list': () => listRepos(),
  'repo:add': async (req, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open local repository' })
    if (r.canceled || !r.filePaths[0]) return null
    if (req?.locate) repoRoot(req.locate) // must be a known entry
    return rememberRepo(await repoTopLevel(r.filePaths[0]), req?.locate)
  },
  'repo:open': async ({ id }) => rememberRepo(await repoTopLevel(repoRoot(id)), id),
  'repo:remove': ({ id }) => forgetRepo(id),
  'repo:reveal': ({ id }) => shell.showItemInFolder(repoRoot(id))
}
