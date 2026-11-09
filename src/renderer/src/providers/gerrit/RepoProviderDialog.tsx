import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Dialog, Heading } from 'react-aria-components'
import type { ProviderState, RepoOverride } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { DialogShell } from '../../motion'

/** Repo provider override (PLAN.md §4.3 step 5): Auto / Gerrit / None + Gerrit base URL. Standalone so Settings can reuse it. */
export function RepoProviderDialog(p: { repo: string; state: ProviderState; onClose(): void }) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState(p.state.override.provider)
  const [url, setUrl] = useState(p.state.override.baseUrl ?? p.state.detection?.baseUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const baseUrl = provider === 'none' ? null : url.trim() || null
    window.mendel['provider:setOverride']({ repo: p.repo, provider, baseUrl }).then(
      (state) => (qc.setQueryData(['provider', p.repo], state), p.onClose()),
      (err: Error) => (setBusy(false), setError(err.message))
    )
  }

  return (
    <DialogShell isDismissable className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog aria-labelledby="provider-title" className={a.dialog}>
        <form className={a.form} onSubmit={submit}>
          <Heading slot="title" id="provider-title">
            Repository provider
          </Heading>
          <label className={a.field}>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as RepoOverride['provider'])} disabled={busy}>
              <option value="auto">Auto</option>
              <option value="gerrit">Gerrit</option>
              <option value="none">None</option>
            </select>
          </label>
          {provider !== 'none' && (
            <label className={a.field}>
              Gerrit URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://gerrit.example.com"
                spellCheck={false}
                disabled={busy}
                autoFocus
              />
            </label>
          )}
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          <div className={a.actions}>
            <button type="button" onClick={p.onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
