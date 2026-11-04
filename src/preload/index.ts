import { contextBridge, ipcRenderer } from 'electron'
import { events, invoke } from '../shared/ipc'

// One fixed function per contract channel; ipcRenderer itself is never exposed (TECH.md §6.1).
const api: Record<string, unknown> = Object.fromEntries(
  Object.keys(invoke).map((c) => [c, (req?: unknown) => ipcRenderer.invoke(c, req)])
)
api.on = (event: string, cb: (payload: unknown) => void) => {
  if (!Object.hasOwn(events, event)) throw new Error(`Unknown event: ${event}`)
  const listener = (_e: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(event, listener)
  return () => void ipcRenderer.removeListener(event, listener)
}

contextBridge.exposeInMainWorld('gitdock', api)
