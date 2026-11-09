import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { RebaseStep } from '../../shared/ipc'
import type { GerritCommit } from '../../shared/gerrit'
import a from './App.module.css'
import { refreshRepo } from './Branches'
import s from './History.module.css'

type Row = GerritCommit & RebaseStep
const ACTIONS: RebaseStep['action'][] = ['pick', 'reword', 'squash', 'fixup', 'drop']

/** Interactive rebase of the unpushed commits (oldest first): reorder with Move up/down, pick an action per commit. */
export function RebaseDialog(p: { repo: string; onClose(): void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['unpushed', p.repo], queryFn: () => window.mendel['history:unpushed']({ repo: p.repo }), gcTime: 0 })
  const [edited, setRows] = useState<Row[] | null>(null)
  const rows = edited ?? q.data?.map((c): Row => ({ ...c, action: 'pick' })) ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows]
    ;[next[i], next[i + d]] = [next[i + d]!, next[i]!]
    setRows(next)
  }
  const setAction = (i: number, action: RebaseStep['action']) => {
    update(i, { action })
    // Reword starts from the commit's full message (body and trailers such as Change-Id included).
    const r = rows[i]!
    if (action === 'reword' && r.message === undefined)
      void window.mendel['history:commit']({ repo: p.repo, sha: r.sha }).then((d) => setRows((cur) => (cur ?? rows).map((x) => (x.sha === r.sha && x.message === undefined ? { ...x, message: d.message } : x))))
  }
  const first = rows.find((r) => r.action !== 'drop')
  const invalid = first && (first.action === 'squash' || first.action === 'fixup') ? `The first commit cannot be a ${first.action}` : null
  const canRun = !busy && rows.length > 0 && !invalid && rows.every((r) => r.action !== 'reword' || r.message?.trim())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canRun) return
    setBusy(true)
    setError(null)
    const steps = rows.map((r) => ({ sha: r.sha, action: r.action, ...(r.action === 'reword' ? { message: r.message } : {}) }))
    // 'conflict' closes too: the conflict banner takes over.
    void window.mendel['history:rebase']({ repo: p.repo, steps })
      .then((r) => r && p.onClose(), (err: Error) => setError(err.message))
      .finally(() => (setBusy(false), void refreshRepo(qc, p.repo)))
  }

  return (
    <ModalOverlay isOpen isDismissable={!busy} className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Modal>
        <Dialog aria-labelledby="rebase-title" className={a.dialog}>
          <form className={a.form} onSubmit={submit}>
            <Heading slot="title" id="rebase-title">
              Edit unpushed commits
            </Heading>
            <p className={a.muted}>Oldest first. Squash and fixup combine a commit into the one above it.</p>
            <ol aria-label="Commits to rebase" className={s.rebaseList}>
              {rows.map((r, i) => (
                <li key={r.sha}>
                  <div className={s.rebaseRow}>
                    <select aria-label={`Action for ${r.short}`} value={r.action} disabled={busy} onChange={(e) => setAction(i, e.target.value as RebaseStep['action'])}>
                      {ACTIONS.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <code>{r.short}</code>
                    <span className={s.summary}>{r.subject}</span>
                    <button type="button" aria-label={`Move ${r.short} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Move ${r.short} down`} disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </div>
                  {r.action === 'reword' && (
                    <textarea aria-label={`New message for ${r.short}`} value={r.message ?? ''} disabled={busy || r.message === undefined} onChange={(e) => update(i, { message: e.target.value })} rows={4} spellCheck={false} />
                  )}
                </li>
              ))}
            </ol>
            {q.data && !rows.length && <p>No unpushed commits.</p>}
            {(invalid ?? error ?? q.error?.message) && (
              <p role="alert" className={a.error}>
                {invalid ?? error ?? q.error?.message}
              </p>
            )}
            <div className={a.actions}>
              <button type="button" onClick={p.onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!canRun}>
                {busy ? 'Rebasing…' : 'Rebase'}
              </button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
