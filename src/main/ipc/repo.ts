import { BrowserWindow, dialog, shell } from 'electron'
import { cloneRepo, validateCloneUrl } from '../git/clone'
import { repoTopLevel } from '../git/repo'
import { cloneParent, forgetRepo, listRepos, rememberRepo, repoRoot } from '../repos'
import { resolveUnder } from '../safe-path'
import { emit, type Handlers } from '.'

let cloning: AbortController | null = null

export const repoHandlers: Handlers<
  'repo:list' | 'repo:add' | 'repo:open' | 'repo:remove' | 'repo:reveal' | 'repo:cloneParent' | 'repo:clone' | 'repo:cloneCancel'
> = {
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
  'repo:reveal': ({ id }) => shell.showItemInFolder(repoRoot(id)),
  'repo:cloneParent': async ({ pick }, e) => {
    if (!pick) return cloneParent()
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: cloneParent() })
    return r.canceled || !r.filePaths[0] ? cloneParent() : cloneParent(r.filePaths[0])
  },
  'repo:clone': async ({ url, name }) => {
    if (cloning) throw new Error('A clone is already running')
    const parent = cloneParent()
    const n = name.trim()
    const dest = n && !/[\\/:*?"<>|]/.test(n) && n !== '.' && n !== '..' ? resolveUnder(parent, n) : null
    if (!dest) throw new Error('Invalid folder name')
    cloning = new AbortController()
    try {
      await cloneRepo(validateCloneUrl(url), dest, { signal: cloning.signal, onProgress: (p) => emit('repo:cloneProgress', p) })
    } finally {
      cloning = null
    }
    return rememberRepo(await repoTopLevel(dest))
  },
  'repo:cloneCancel': () => cloning?.abort()
}
