import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { promptContext, promptKind, type PromptOrigin } from '../auth/askpass'
import { emit, type Handlers } from '.'

const PROMPT_TIMEOUT_MS = 5 * 60_000
const pending = new Map<string, (value: string | null) => void>()

/**
 * Show a git/ssh prompt in the renderer and wait for the answer (null = cancelled / timed out / no window).
 * `signal` (git exited, askpass client gone) settles null and dismisses the modal (R15).
 */
export function askUser(prompt: string, origin: PromptOrigin, signal?: AbortSignal): Promise<string | null> {
  if (BrowserWindow.getAllWindows().length === 0 || signal?.aborted) return Promise.resolve(null)
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(null), PROMPT_TIMEOUT_MS)
    const settle = (value: string | null) => {
      if (!pending.delete(id)) return
      clearTimeout(timer)
      signal?.removeEventListener('abort', dismiss)
      resolve(value)
    }
    const dismiss = () => {
      if (pending.has(id)) emit('auth:dismiss', { id })
      settle(null)
    }
    pending.set(id, settle)
    signal?.addEventListener('abort', dismiss)
    emit('auth:prompt', { id, kind: promptKind(prompt), prompt, context: promptContext(origin) })
  })
}

export const authHandlers: Handlers<'auth:respond'> = {
  'auth:respond': ({ id, value }) => pending.get(id)?.(value)
}
