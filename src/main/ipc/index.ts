import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { invoke, type EventChannel, type EventPayload, type InvokeChannel, type Req, type Res } from '../../shared/ipc'
import log from '../log'
import { redact } from '../redact'
import { appOrigin } from '../security'
import { appHandlers } from './app'
import { authHandlers } from './auth'
import { changesHandlers } from './changes'
import { gitHandlers } from './git'
import { repoHandlers } from './repo'

export type Handlers<C extends InvokeChannel = InvokeChannel> = {
  [K in C]: (req: Req<K>, e: IpcMainInvokeEvent) => Res<K> | Promise<Res<K>>
}

/** Only the top frame of one of our windows, served from our origin, may call main (TECH.md §6.2). */
function trusted(e: IpcMainInvokeEvent): boolean {
  const f = e.senderFrame
  return !!f && f === e.sender.mainFrame && f.origin === appOrigin && !!BrowserWindow.fromWebContents(e.sender)
}

/** Add each channel group's handlers here; the type forces every channel in the contract to be handled. */
export function registerIpc(): void {
  const handlers: Handlers = { ...appHandlers, ...gitHandlers, ...authHandlers, ...repoHandlers, ...changesHandlers }
  for (const channel of Object.keys(invoke) as InvokeChannel[]) {
    ipcMain.handle(channel, async (e, raw: unknown) => {
      if (!trusted(e)) throw new Error('Untrusted IPC sender')
      const req = invoke[channel].req.parse(raw)
      try {
        return await (handlers[channel] as (r: unknown, e: IpcMainInvokeEvent) => unknown)(req, e)
      } catch (err) {
        log.error(`[ipc] ${channel}`, err)
        throw new Error(redact(err instanceof Error ? err.message : String(err)))
      }
    })
  }
}

/** Push an event to every window's renderer. */
export function emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}
