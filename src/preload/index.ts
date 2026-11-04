import { contextBridge, ipcRenderer } from 'electron'
import { events, invoke } from '../shared/ipc'

// One fixed function per contract channel; ipcRenderer itself is never exposed (TECH.md §6.1).
const api: Record<string, unknown> = Object.fromEntries(
  Object.keys(invoke).map((c) => [
    c,
    // Electron prefixes main's error text with "Error invoking remote method '<c>': Error: "; show only main's message.
    (req?: unknown) =>
      ipcRenderer.invoke(c, req).catch((err: Error) => {
        throw new Error(err.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''))
      })
  ])
)
api.on = (event: string, cb: (payload: unknown) => void) => {
  if (!Object.hasOwn(events, event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(event, listener)
  return () => void ipcRenderer.removeListener(event, listener)
}

contextBridge.exposeInMainWorld('gitdock', api)
