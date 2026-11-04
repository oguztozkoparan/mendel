import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { IpcError } from '../../shared/ipc'
import a from './App.module.css'

/** What the banner shows: a failed call's error plus, for retryable ops, how to run it again. */
export interface BannerError extends IpcError {
  retry?: () => void
}

/** Friendly text per GitError kind (Unknown / non-git errors show their message). */
const FRIENDLY: Record<string, string> = {
  GitNotFound: 'Git was not found. Install it, then try again.',
  NotARepository: 'Not a git repository.',
  DubiousOwnership: 'This folder is owned by another user (dubious ownership), so git refuses to open it.',
  AuthFailed: 'Authentication failed. Check your credentials or SSH key.',
  HostKeyVerificationFailed: "The server's SSH host key could not be verified.",
  RemoteUnreachable: 'Could not reach the remote. Check your network connection and the remote URL.',
  PushRejected: 'The remote rejected the push.',
  MergeConflict: 'Stopped on conflicts. Resolve them, then continue.',
  IndexLocked: 'Another git process is using this repository (index.lock exists). Wait for it to finish, then retry.',
  Cancelled: 'Cancelled.',
  Timeout: 'The git operation timed out.',
  OutputTooLarge: 'Git output was too large.'
}
/** Kinds where running the same op again can succeed. */
const RETRYABLE = new Set(['AuthFailed', 'RemoteUnreachable', 'IndexLocked', 'Timeout'])

/** `e` from a rejected `window.mendel` call (an Error or an IpcError), with an optional retry. */
export const bannerError = (e: unknown, retry?: () => void): BannerError => {
  const { message, kind, details } = (e ?? {}) as IpcError
  return { message: message ?? String(e), kind, details, retry }
}

/** Inline red banner (PLAN.md §3 "error"): friendly text, Show details (redacted stderr), Copy, Retry, Dismiss. */
export function ErrorBanner({ error, onDismiss }: { error: BannerError; onDismiss(): void }) {
  const [open, setOpen] = useState(false)
  const friendly = (error.kind && FRIENDLY[error.kind]) || error.message
  const stderr = error.details?.trim()
  const details = [error.message !== friendly ? error.message : '', stderr !== error.message.trim() ? stderr : ''].filter(Boolean).join('\n\n')
  return (
    <div role="alert" className={a.banner}>
      <span>
        {friendly}
        {open && details && <pre className={a.details}>{details}</pre>}
      </span>
      {details && <Button onPress={() => setOpen(!open)}>{open ? 'Hide details' : 'Show details'}</Button>}
      <Button onPress={() => void window.mendel['app:copy']({ text: details ? `${friendly}\n\n${details}` : friendly })}>Copy</Button>
      {error.retry && error.kind && RETRYABLE.has(error.kind) && <Button onPress={() => (onDismiss(), error.retry!())}>Retry</Button>}
      <Button onPress={onDismiss}>Dismiss</Button>
    </div>
  )
}
