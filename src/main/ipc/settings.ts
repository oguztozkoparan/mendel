import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { detectTools, validCustomTool } from '../external'
import { endOfOptions, git } from '../git/runner'
import log from '../log'
import { getSettings, setSettings } from '../settings'
import type { Handlers } from '.'

const config = (key: string) => git(['config', '--global', '--get', key], { cwd: os.homedir() }).then((r) => r.stdout.trim(), () => '')

export const settingsHandlers: Handlers<'settings:get' | 'settings:set' | 'settings:tools' | 'settings:pickTool' | 'settings:gitIdentity' | 'settings:setGitIdentity' | 'settings:openLogs'> = {
  'settings:get': () => getSettings(),
  'settings:set': (patch) => setSettings(patch),
  'settings:tools': () => {
    const ids = (kind: 'editor' | 'terminal') => detectTools(kind).map(({ id, name }) => ({ id, name }))
    return { editors: ids('editor'), terminals: ids('terminal') }
  },
  'settings:pickTool': async ({ kind }, e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: `Choose ${kind} application`, defaultPath: process.platform === 'darwin' ? '/Applications' : undefined })
    const p = r.filePaths[0]
    if (r.canceled || !p) return getSettings()
    if (!validCustomTool(p)) throw new Error(`Not an application or executable: ${p}`)
    return setSettings(kind === 'editor' ? { editor: 'custom', editorPath: p } : { terminal: 'custom', terminalPath: p })
  },
  'settings:gitIdentity': async () => ({ name: await config('user.name'), email: await config('user.email') }),
  'settings:setGitIdentity': async ({ name, email }) => {
    const cwd = os.homedir()
    await git(['config', '--global', ...endOfOptions('user.name', name)], { cwd })
    await git(['config', '--global', ...endOfOptions('user.email', email)], { cwd })
  },
  'settings:openLogs': async () => {
    const err = await shell.openPath(path.dirname(log.transports.file.getFile().path))
    if (err) throw new Error(err)
  }
}
