import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Dialog, Heading } from 'react-aria-components'
import type { GerritChange } from '../../../../shared/gerrit'
import a from '../../App.module.css'
import type { PendingStore } from './Comments'
import s from './Gerrit.module.css'
import { fileLabel, fmtVote } from './util'
import { DialogShell } from '../../motion'

/**
 * Reply panel (PLAN.md §3.8, §4.5): overall message, vote pickers built only from `permitted_labels`, pending
 * inline comments; all sent in one review call. On failure the pending comments are kept.
 */
export function ReplyDialog(p: { repo: string; change: GerritChange; patchSet: number; me: number | null; pending: PendingStore; onClose(): void }) {
  const qc = useQueryClient()
  const ch = p.change
  const permitted = Object.entries(ch.permitted_labels ?? {}).map(([label, values]) => [label, values.map(Number).sort((x, y) => x - y)] as const)
  const mine = (label: string) => ch.labels?.[label]?.all?.find((v) => p.me !== null && v._account_id === p.me)?.value ?? 0
  const [votes, setVotes] = useState<Record<string, number>>(() => Object.fromEntries(permitted.map(([l]) => [l, mine(l)])))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const labels = Object.fromEntries(Object.entries(votes).filter(([l, v]) => v !== mine(l)))
    // One call per patch set: replies on older ones first (comments only), message + votes on the current one last.
    // Drafts are dropped after each successful call, so a retry after a partial failure never posts them twice.
    const sets = [...new Set(p.pending.list.map((d) => d.patch_set).filter((ps) => ps !== p.patchSet)), p.patchSet]
    const post = async () => {
      for (const ps of sets) {
        const drafts = p.pending.list.filter((d) => d.patch_set === ps)
        const last = ps === p.patchSet
        const comments = drafts.map(({ key: _k, ...d }) => d)
        await window.mendel['gerrit:review']({ repo: p.repo, change: ch._number, patchSet: ps, message: last ? message.trim() : '', labels: last ? labels : {}, comments })
        drafts.forEach((d) => p.pending.remove(d.key))
      }
    }
    post().then(
      () => {
        void qc.invalidateQueries({ queryKey: ['gerrit', p.repo] })
        p.onClose()
      },
      (err: Error) => (setBusy(false), setError(err.message))
    )
  }

  return (
    <DialogShell isDismissable={!busy} className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog aria-labelledby="reply-title" className={`${a.dialog} ${s.wide}`}>
        <form className={a.form} onSubmit={send}>
          <Heading slot="title" id="reply-title">
            Reply to #{ch._number}
          </Heading>
          <textarea aria-label="Message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} autoFocus />
          {permitted.map(([label, values]) => (
            <div key={label} role="radiogroup" aria-label={label} className={s.labelRow}>
              <strong>{label}</strong>
              {values.map((v) => (
                <label key={v} className={s.radio}>
                  <input type="radio" name={label} checked={votes[label] === v} onChange={() => setVotes((x) => ({ ...x, [label]: v }))} disabled={busy} />
                  {fmtVote(v)}
                </label>
              ))}
            </div>
          ))}
          {p.pending.list.length > 0 && (
            <ul aria-label="Pending comments" className={s.pendingList}>
              {p.pending.list.map((d) => (
                <li key={d.key}>
                  <span className={s.grow}>
                    {fileLabel(d.path)}
                    {d.line ? `:${d.line}` : ''} (PS {d.patch_set}) — {d.message}
                  </span>
                  <button type="button" onClick={() => p.pending.remove(d.key)} disabled={busy}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          <div className={a.actions}>
            <button type="button" onClick={p.onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Send
            </button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
