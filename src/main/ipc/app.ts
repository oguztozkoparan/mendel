import { app } from 'electron'
import type { Handlers } from '.'

export const appHandlers: Handlers<'app:info'> = {
  'app:info': () => ({ version: app.getVersion(), platform: process.platform })
}
