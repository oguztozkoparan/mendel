import { contextBridge, ipcRenderer } from 'electron'
import { events, invoke, IPC_ERROR_PREFIX, type IpcError } from '../shared/ipc'

// One fixed function per contract channel; ipcRenderer itself is never exposed (TECH.md §6.1).
const api: Record<string, unknown> = Object.fromEntries(
  Object.keys(invoke).map((c) => [
    c,
    // Electron prefixes main's error text with "Error invoking remote method '<c>': Error: "; show only main's message.
    (req?: unknown) =>
      ipcRenderer.invoke(c, req).catch((err: Error) => {
        const msg = err.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
        if (!msg.startsWith(IPC_ERROR_PREFIX)) throw new Error(msg)
        // A plain object: custom Error properties would be dropped by contextBridge.
        const e = JSON.parse(msg.slice(IPC_ERROR_PREFIX.length)) as IpcError
        throw { name: 'GitError', message: e.message, kind: e.kind, details: e.details }
      })
  ])
)
api.on = (event: string, cb: (payload: unknown) => void) => {
  if (!Object.hasOwn(events, event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(event, listener)
  return () => void ipcRenderer.removeListener(event, listener)
}

contextBridge.exposeInMainWorld('mendel', api)
