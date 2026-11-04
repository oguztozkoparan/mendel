import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { endOfOptions, git } from '../git/runner'
import log from '../log'
import { getSettings, setSettings } from '../settings'
import type { Handlers } from '.'

const config = (key: string) => git(['config', '--global', '--get', key], { cwd: os.homedir() }).then((r) => r.stdout.trim(), () => '')

export const settingsHandlers: Handlers<'settings:get' | 'settings:set' | 'settings:gitIdentity' | 'settings:setGitIdentity' | 'settings:openLogs'> = {
  'settings:get': () => getSettings(),
  'settings:set': (patch) => setSettings(patch),
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
