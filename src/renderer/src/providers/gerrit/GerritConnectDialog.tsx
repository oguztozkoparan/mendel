import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Dialog, Heading } from 'react-aria-components'
import type { GerritConnected } from '../../../../shared/gerrit'
import type { ProviderState } from '../../../../shared/ipc'
import a from '../../App.module.css'
import s from './Gerrit.module.css'
import { DialogShell } from '../../motion'

/**
 * Gerrit credentials (PLAN.md §4.9): base URL, username, HTTP password / token → "Test & save".
 * Standalone so the Settings page can open it too. The secret goes to main once and never comes back.
 */
export function GerritConnectDialog(p: { repo: string; state: ProviderState; expired?: boolean; onClose(): void }) {
  const qc = useQueryClient()
  const d = p.state.detection
  const [baseUrl, setBaseUrl] = useState(d?.baseUrl ?? '')
  const [username, setUsername] = useState(p.state.credentialUser ?? d?.user ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<GerritConnected | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['provider', p.repo] })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    window.mendel['gerrit:connect']({ repo: p.repo, baseUrl, username, password }).then(
      (r) => (setBusy(false), setPassword(''), setDone(r), void refresh(), void qc.invalidateQueries({ queryKey: ['gerrit', p.repo] })),
      (err: Error) => (setBusy(false), setError(err.message))
    )
  }
  const remove = () => void window.mendel['gerrit:disconnect']({ repo: p.repo }).then(() => (void refresh(), p.onClose()))

  return (
    <DialogShell isDismissable={!busy} className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog aria-labelledby="gerrit-connect-title" className={a.dialog}>
        <form className={a.form} onSubmit={submit}>
          <Heading slot="title" id="gerrit-connect-title">
            Connect to Gerrit{d?.host ? ` (${d.host})` : ''}
          </Heading>
          {p.expired && <p className={a.error}>The saved credential was rejected; it may have expired.</p>}
          <label className={a.field}>
            Gerrit URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gerrit.example.com" spellCheck={false} disabled={busy} />
          </label>
          <label className={a.field}>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} disabled={busy} autoFocus={!username} />
          </label>
          <label className={a.field}>
            HTTP password / token
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              disabled={busy}
              autoFocus={!!username}
              placeholder={p.state.credentialUser ? '••• saved' : ''}
            />
          </label>
          {d?.baseUrl && (
            <button type="button" className={s.link} onClick={() => void window.mendel['gerrit:open']({ repo: p.repo, path: 'settings/#HTTPCredentials' })}>
              Get your HTTP password
            </button>
          )}
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          {done && (
            <p role="status">
              Connected as {done.name}
              {done.email && ` (${done.email})`}
              {!done.persisted && '. No OS keychain available: the password is kept for this session only.'}
            </p>
          )}
          <div className={a.actions}>
            {p.state.credentialUser && (
              <button type="button" onClick={remove} disabled={busy}>
                Remove credentials
              </button>
            )}
            <button type="button" onClick={p.onClose} disabled={busy}>
              {done ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" className="primary" disabled={busy || !baseUrl.trim() || !username.trim() || !password}>
              Test & save
            </button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
