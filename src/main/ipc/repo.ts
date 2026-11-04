import { BrowserWindow, dialog, shell } from 'electron'
import { cloneRepo, validateCloneUrl } from '../git/clone'
import { dubiousDir, repoTopLevel, trustDirectory } from '../git/repo'
import { cloneParent, forgetRepo, listRepos, rememberRepo, repoRoot } from '../repos'
import { resolveUnder } from '../safe-path'
import { emit, type Handlers } from '.'

let cloning: AbortController | null = null

/** repoTopLevel; on "dubious ownership" ask (native, in main) to trust exactly that folder, then retry (S16). */
async function topLevelTrusting(dir: string, win: BrowserWindow | null): Promise<string> {
  try {
    return await repoTopLevel(dir)
  } catch (err) {
    const at = dubiousDir(err)
    if (!at) throw err
    const opts = {
      type: 'warning' as const,
      buttons: ['Trust this folder', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `${at} is owned by another user`,
      detail: `Git refuses to open repositories owned by someone else: their settings could run programs as you. Trust it only if you know who controls this folder.\n\nThis runs: git config --global --add safe.directory ${at}`
    }
    if ((await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))).response !== 0) throw err
    await trustDirectory(at)
    return repoTopLevel(dir)
  }
}

export const repoHandlers: Handlers<
  'repo:list' | 'repo:add' | 'repo:open' | 'repo:remove' | 'repo:reveal' | 'repo:cloneParent' | 'repo:clone' | 'repo:cloneCancel'
> = {
  'repo:list': () => listRepos(),
  'repo:add': async (req, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open local repository' })
    if (r.canceled || !r.filePaths[0]) return null
    if (req?.locate) repoRoot(req.locate) // must be a known entry
    return rememberRepo(await topLevelTrusting(r.filePaths[0], win), req?.locate)
  },
  'repo:open': async ({ id }, e) => rememberRepo(await topLevelTrusting(repoRoot(id), BrowserWindow.fromWebContents(e.sender)), id),
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
