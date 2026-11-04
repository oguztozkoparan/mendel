import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { promptKind } from '../auth/askpass'
import { emit, type Handlers } from '.'

const PROMPT_TIMEOUT_MS = 5 * 60_000
const pending = new Map<string, (value: string | null) => void>()

/** Show a git/ssh prompt in the renderer and wait for the answer (null = cancelled / timed out / no window). */
export function askUser(prompt: string): Promise<string | null> {
  if (BrowserWindow.getAllWindows().length === 0) return Promise.resolve(null)
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(null), PROMPT_TIMEOUT_MS)
    const settle = (value: string | null) => {
      clearTimeout(timer)
      pending.delete(id)
      resolve(value)
    }
    pending.set(id, settle)
    emit('auth:prompt', { id, kind: promptKind(prompt), prompt })
  })
}

export const authHandlers: Handlers<'auth:respond'> = {
  'auth:respond': ({ id, value }) => pending.get(id)?.(value)
}
