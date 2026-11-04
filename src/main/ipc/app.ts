import { app, clipboard } from 'electron'
import type { Handlers } from '.'

export const appHandlers: Handlers<'app:info' | 'app:copy'> = {
  'app:info': () => ({ version: app.getVersion(), platform: process.platform }),
  'app:copy': ({ text }) => clipboard.writeText(text)
}
