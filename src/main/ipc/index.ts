import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { invoke, IPC_ERROR_PREFIX, type EventChannel, type EventPayload, type InvokeChannel, type Req, type Res } from '../../shared/ipc'
import log from '../log'
import { GitError } from '../git/runner'
import { redact } from '../redact'
import { appOrigin } from '../security'
import { appHandlers } from './app'
import { authHandlers } from './auth'
import { branchHandlers } from './branch'
import { changesHandlers } from './changes'
import { commitHandlers } from './commit'
import { conflictHandlers } from './conflict'
import { gerritHandlers } from './gerrit'
import { githubHandlers } from './github'
import { gitHandlers } from './git'
import { historyHandlers } from './history'
import { providerHandlers } from './provider'
import { repoHandlers } from './repo'
import { settingsHandlers } from './settings'
import { syncHandlers } from './sync'
import { tagHandlers } from './tag'
import { updateHandlers } from './update'
import { worktreeHandlers } from './worktree'

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
  const handlers: Handlers = { ...appHandlers, ...gitHandlers, ...authHandlers, ...repoHandlers, ...changesHandlers, ...commitHandlers, ...updateHandlers, ...branchHandlers, ...syncHandlers, ...historyHandlers, ...tagHandlers, ...conflictHandlers, ...settingsHandlers, ...providerHandlers, ...gerritHandlers, ...githubHandlers, ...worktreeHandlers }
  for (const channel of Object.keys(invoke) as InvokeChannel[]) {
    ipcMain.handle(channel, async (e, raw: unknown) => {
      if (!trusted(e)) throw new Error('Untrusted IPC sender')
      const req = invoke[channel].req.parse(raw)
      try {
        return await (handlers[channel] as (r: unknown, e: IpcMainInvokeEvent) => unknown)(req, e)
      } catch (err) {
        log.error(`[ipc] ${channel}`, err)
        const message = redact(err instanceof Error ? err.message : String(err))
        // Git failures keep their kind + redacted stderr for the error banner (preload decodes this).
        if (err instanceof GitError) throw new Error(IPC_ERROR_PREFIX + JSON.stringify({ message, kind: err.kind, details: redact(err.stderr) || undefined }))
        throw new Error(message)
      }
    })
  }
}

/** Push an event to every window's renderer. */
export function emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}
