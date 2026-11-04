import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { fetchCommand, GERRIT_REBASE_CONFLICT, type GerritChange } from '../../../../shared/gerrit'
import a from '../../App.module.css'
import { refreshRepo } from '../../Branches'
import type { Revision } from './ChangeDetail'
import s from './Gerrit.module.css'

type Action = 'submit' | 'abandon' | 'rebase'
const DONE: Record<Action, string> = {
  submit: 'Change merged. Pull to update your local branch.',
  abandon: 'Change abandoned.',
  rebase: 'Rebased on the server.'
}

/**
 * Submit / Rebase (current revision actions) and Abandon (change actions): shown only when the server lists them (PLAN.md §4.5).
 * Checkout locally (patch set `ps`, §4.7) and, after a server rebase conflict, Rebase locally (§4.8) work on the local repo.
 */
export function ChangeActions({ repo, change, current, ps }: { repo: string; change: GerritChange; current?: Revision; ps: number }) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState<'submit' | 'abandon' | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const remote = useQuery({ queryKey: ['provider', repo], queryFn: () => window.mendel['provider:get']({ repo }) }).data?.detection?.remote
  const ra = current?.actions ?? {}
  const ca = change.actions ?? {}

  const run = (action: Action) => {
    setBusy(true)
    setNotice(null)
    window.mendel['gerrit:action']({ repo, change: change._number, action, message: action === 'abandon' ? message.trim() : undefined }).then(
      () => (setNotice({ error: false, text: DONE[action] }), void qc.invalidateQueries({ queryKey: ['gerrit', repo] })),
      (err: Error) => setNotice({ error: true, text: err.message })
    ).finally(() => (setBusy(false), setConfirm(null), setMessage('')))
  }
  const submit = (e: FormEvent) => (e.preventDefault(), run(confirm!))
  /** A local git op: its result text (null = cancelled, no notice), then the repo views refresh. */
  const local = (p: Promise<string | null>) => {
    setBusy(true)
    setNotice(null)
    p.then(
      (text) => text && setNotice({ error: false, text }),
      (err: Error) => setNotice({ error: true, text: err.message })
    ).finally(() => (setBusy(false), void refreshRepo(qc, repo)))
  }
  const checkout = () =>
    local(window.mendel['gerrit:checkout']({ repo, change: change._number, patchSet: ps, branch: change.branch }).then((b) => b && `Checked out #${change._number} PS${ps} on ${b}`))
  const rebaseLocally = () =>
    local(
      window.mendel['sync:rebase']({ repo }).then((r) =>
        r === 'conflict' ? 'Rebase stopped on conflicts: resolve them, then continue.' : r && 'Rebased locally. Send for review to upload the rebased patch set.'
      )
    )

  return (
    <>
      {ra.submit && (
        <Button isDisabled={busy || !ra.submit.enabled} aria-description={ra.submit.title} onPress={() => setConfirm('submit')}>
          Submit…
        </Button>
      )}
      {ra.rebase && (
        <Button isDisabled={busy || !ra.rebase.enabled} aria-description={ra.rebase.title} onPress={() => run('rebase')}>
          Rebase
        </Button>
      )}
      <Button isDisabled={busy} onPress={checkout}>
        Checkout locally
      </Button>
      {remote && (
        <Button
          isDisabled={busy}
          onPress={() =>
            void window.mendel['app:copy']({ text: fetchCommand(remote, change._number, ps) }).then(
              () => setNotice({ error: false, text: 'Fetch command copied' }),
              (err: Error) => setNotice({ error: true, text: err.message })
            )
          }
        >
          Copy fetch command
        </Button>
      )}
      {ca.abandon && (
        <Button isDisabled={busy || !ca.abandon.enabled} onPress={() => setConfirm('abandon')}>
          Abandon…
        </Button>
      )}
      {notice && (
        <span role={notice.error ? 'alert' : 'status'} className={notice.error ? a.error : s.meta}>
          {notice.text}
        </span>
      )}
      {notice?.text === GERRIT_REBASE_CONFLICT && (
        <Button isDisabled={busy} onPress={rebaseLocally}>
          Rebase locally
        </Button>
      )}
      {confirm && (
        <ModalOverlay isOpen isDismissable={!busy} className={a.backdrop} onOpenChange={(o) => !o && setConfirm(null)}>
          <Modal>
            <Dialog aria-labelledby="action-title" className={a.dialog}>
              <form className={a.form} onSubmit={submit}>
                <Heading slot="title" id="action-title">
                  {confirm === 'submit' ? 'Submit' : 'Abandon'} #{change._number}?
                </Heading>
                <p>{change.subject}</p>
                {confirm === 'abandon' && <textarea aria-label="Message (optional)" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} />}
                <div className={a.actions}>
                  <button type="button" onClick={() => setConfirm(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={busy} autoFocus>
                    {confirm === 'submit' ? 'Submit' : 'Abandon'}
                  </button>
                </div>
              </form>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </>
  )
}
