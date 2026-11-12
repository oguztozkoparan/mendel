import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { detectTools, openInEditor, validCustomTool } from '../external'
import { globalConfigFile, readConfig, writeConfig } from '../git/config'
import { assignProfile, createProfile, deleteProfile, listProfiles, profilesDir, profileUsage, repoGitConfig, updateProfile } from '../gitProfiles'
import log from '../log'
import { repoRoot } from '../repos'
import { getSettings, setSettings } from '../settings'
import { confirm } from './branch'
import type { Handlers } from '.'

export const settingsHandlers: Handlers<'settings:get' | 'settings:set' | 'settings:tools' | 'settings:pickTool' | 'settings:gitIdentity' | 'settings:setGitIdentity' | 'settings:openGitConfig' | 'settings:gitProfiles' | 'settings:createGitProfile' | 'settings:updateGitProfile' | 'settings:deleteGitProfile' | 'settings:repoGitConfig' | 'settings:assignGitProfile' | 'settings:setRepoGitConfig' | 'settings:openLogs'> = {
  'settings:get': () => getSettings(),
  'settings:set': (patch) => setSettings(patch),
  'settings:tools': () => {
    const ids = (kind: 'editor' | 'terminal') => detectTools(kind).map(({ id, name }) => ({ id, name }))
    return { editors: ids('editor'), terminals: ids('terminal') }
  },
  'settings:pickTool': async ({ kind }, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: `Choose ${kind} application`,
      defaultPath: process.platform === 'darwin' ? '/Applications' : undefined,
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : undefined
    })
    const p = r.filePaths[0]
    if (r.canceled || !p) return getSettings()
    if (!validCustomTool(p)) throw new Error(`Not an application or executable: ${p}`)
    return setSettings(kind === 'editor' ? { editor: 'custom', editorPath: p } : { terminal: 'custom', terminalPath: p })
  },
  'settings:gitIdentity': () => readConfig('global', os.homedir()),
  'settings:setGitIdentity': (values) => writeConfig('global', os.homedir(), values),
  'settings:openGitConfig': async () => {
    const file = globalConfigFile()
    if (!file) throw new Error('No global git config file yet: save the form first')
    // Root = its own folder, so the root check is moot: the path is git's own choice (no renderer input); openInEditor's
    // System default still never runs it (non-text extension on the resolved target = reveal only).
    const real = await realpath(file)
    await openInEditor(path.dirname(real), real)
  },
  'settings:gitProfiles': () => listProfiles(profilesDir()),
  'settings:createGitProfile': async ({ name, values }) => void (await createProfile(profilesDir(), name, values)),
  'settings:updateGitProfile': ({ id, name, values }) => updateProfile(profilesDir(), id, name, values),
  'settings:deleteGitProfile': async ({ id }, e) => {
    const { name, repos } = profileUsage(profilesDir(), id)
    const used = repos ? ` ${repos === 1 ? 'One repository uses' : `${repos} repositories use`} it and will use the global config again.` : ''
    if (!(await confirm(e, 'Delete', `Delete profile ${name}?`, `Its git config file is removed.${used}`))) return false
    await deleteProfile(profilesDir(), id)
    return true
  },
  'settings:repoGitConfig': ({ repo }) => repoGitConfig(profilesDir(), repo, repoRoot(repo)),
  'settings:assignGitProfile': ({ repo, profileId }) => assignProfile(profilesDir(), repo, repoRoot(repo), profileId),
  // In a linked worktree --local writes the shared repository config, so the main work tree and its worktrees agree.
  'settings:setRepoGitConfig': ({ repo, values }) => writeConfig('local', repoRoot(repo), values),
  'settings:openLogs': async () => {
    const err = await shell.openPath(path.dirname(log.transports.file.getFile().path))
    if (err) throw new Error(err)
  }
}
