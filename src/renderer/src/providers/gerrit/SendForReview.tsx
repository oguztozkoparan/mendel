import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Dialog, Heading } from 'react-aria-components'
import { PUSH_OPTION_VALUE, reviewRef, type GerritSent } from '../../../../shared/gerrit'
import a from '../../App.module.css'
import { refreshRepo } from '../../Branches'
import s from './Gerrit.module.css'
import { DialogShell } from '../../motion'

/** Send for review (PLAN.md §3.9): target, commits that will be pushed, topic, reviewers, WIP and the final ref. */
export function SendForReview(p: { repo: string; onClose(): void; onSent(r: GerritSent): void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['gerritPending', p.repo], queryFn: () => window.mendel['gerrit:pending']({ repo: p.repo }) })
  const [target, setTarget] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [reviewers, setReviewers] = useState('')
  const [wip, setWip] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commits = q.data?.commits ?? []
  const tgt = (target ?? q.data?.target ?? '').trim()
  const list = reviewers.split(',').map((r) => r.trim()).filter(Boolean)
  const invalid = [topic.trim(), ...list].some((v) => v && !PUSH_OPTION_VALUE.test(v))
  const opts = { topic: topic.trim() || undefined, reviewers: list, wip, ready: ready && !wip }
  const ref = tgt && !invalid ? reviewRef(tgt, opts) : null
  const missing = commits.filter((c) => !c.changeId)
  const canSend = !busy && !!ref && commits.length > 0 && !missing.length

  const run = (pr: Promise<unknown>) => {
    setBusy(true)
    setError(null)
    return pr.catch((err: Error) => (setError(err.message), null)).finally(() => (setBusy(false), void refreshRepo(qc, p.repo)))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (canSend) void run(window.mendel['gerrit:send']({ repo: p.repo, target: tgt, ...opts }).then(p.onSent))
  }

  return (
    <DialogShell isDismissable={!busy} className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog aria-labelledby="send-title" className={a.dialog}>
        <form className={a.form} onSubmit={submit}>
          <Heading slot="title" id="send-title">
            Send for review
          </Heading>
          <label className={a.field}>
            <span>Target branch</span>
            <input value={target ?? q.data?.target ?? ''} onChange={(e) => setTarget(e.target.value)} spellCheck={false} disabled={busy} />
          </label>
          {q.data && (
            <ul aria-label="Commits to send" className={s.pendingList}>
              {commits.map((c) => (
                <li key={c.sha}>
                  <code>{c.short}</code> {c.subject}
                  {!c.changeId && <strong> (no Change-Id)</strong>}
                </li>
              ))}
            </ul>
          )}
          {commits.length > 1 && <p role="note">This creates/updates {commits.length} changes.</p>}
          {missing.length > 0 && (
            <div role="alert" className={a.error}>
              {missing.length === 1 && missing[0] === commits[0] ? (
                <>
                  The last commit has no Change-Id.{' '}
                  <button type="button" disabled={busy} onClick={() => void run(window.mendel['gerrit:addChangeId']({ repo: p.repo }))}>
                    Add Change-Id to last commit
                  </button>
                </>
              ) : (
                `${missing.length} commits have no Change-Id. Add them in a terminal (git rebase -i), then send again.`
              )}
            </div>
          )}
          <label className={a.field}>
            Topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} spellCheck={false} disabled={busy} />
          </label>
          <label className={a.field}>
            Reviewers
            <input value={reviewers} onChange={(e) => setReviewers(e.target.value)} placeholder="a@example.com, username" spellCheck={false} disabled={busy} />
          </label>
          <label>
            <input type="checkbox" checked={wip} onChange={(e) => setWip(e.target.checked)} disabled={busy} /> Work in progress
          </label>
          {q.data?.headChange?.wip && (
            <label>
              <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} disabled={busy || wip} /> Mark ready (#{q.data.headChange.number} is
              work in progress)
            </label>
          )}
          {invalid && <p className={a.error}>Topic and reviewers may only use letters, digits and . _ @ + - (reviewers comma-separated).</p>}
          {ref && <code aria-label="Push ref">HEAD:{ref}</code>}
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          <div className={a.actions}>
            <button type="button" onClick={p.onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSend}>
              {q.data && !commits.length ? 'Nothing to send' : busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
