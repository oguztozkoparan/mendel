import { app, clipboard } from 'electron'
import { glass } from '../window'
import type { Handlers } from '.'

export const appHandlers: Handlers<'app:info' | 'app:copy'> = {
  'app:info': () => ({ version: app.getVersion(), platform: process.platform, glass }),
  'app:copy': ({ text }) => clipboard.writeText(text)
}
