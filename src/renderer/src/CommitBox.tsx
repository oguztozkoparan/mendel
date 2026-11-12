import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Maximize2 } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, Checkbox, Dialog, Heading, Input, TextArea, TextField } from 'react-aria-components'
import a from './App.module.css'
import { refreshRepo } from './Branches'
import s from './Changes.module.css'
import { DialogShell } from './motion'
import { useSettings } from './Settings'

/** A provider's commit-box message (PLAN.md §5.3 "commit-message checks / hints"). */
export interface CommitHint {
  note: string
  /** Pre-tick "Amend last commit" and show this while it is ticked (Gerrit: "Will upload a new patchset of #N"). */
  amend?: string
  /** One-click fix, e.g. "Add Change-Id to last commit". */
  fix?: { label: string; run(): Promise<unknown> }
}

/** Commit box (PLAN.md 3.5): summary, description, amend (prefilled from HEAD), Mod+Enter commits. */
export function CommitBox(p: { repo: string; hasStaged: boolean; hint?: CommitHint | null; amend?: boolean; onAmendDone?: () => void }) {
  const { repo, hasStaged, hint } = p
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['commitInfo', repo], queryFn: () => window.mendel['commit:info']({ repo }) })
  // Same query as the conflict banner: while any op is stopped, Continue there is the primary (one primary per screen).
  // Only a rebase goes on after a commit; a commit itself concludes a merge, cherry-pick or revert.
  const op = useQuery({ queryKey: ['conflict', repo], queryFn: () => window.mendel['conflict:state']({ repo }) }).data ?? null
  const rebasing = op === 'rebase'
  const settings = useSettings().data
  const limit = settings?.summaryLimit ?? 72
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const head = info.data?.head ?? null
  const amending = amend && op === null
  const canCommit = !busy && summary.trim() !== '' && (hasStaged || amending)

  const toggleAmend = (on: boolean) => {
    setAmend(on)
    if (on && head !== null) {
      const [first = '', ...rest] = head.split('\n')
      setSummary(first)
      setDescription(rest.join('\n').replace(/^\n+/, ''))
    }
  }
  // Pre-tick amend for a provider (PLAN.md §4.4 step 4) unless the user is already writing a message.
  // Wait for a fresh HEAD message: a cached one (commit made outside the app) would replace the commit's message.
  const preAmend = !!hint?.amend && head !== null && !info.isFetching && !amend && !summary && !description
  useEffect(() => {
    if (preAmend) toggleAmend(true)
  }, [preAmend])
  // Explicit request (History "Amend"): tick it once HEAD's message is fresh.
  const amendNow = !!p.amend && head !== null && !info.isFetching
  useEffect(() => {
    if (amendNow) (toggleAmend(true), p.onAmendDone?.())
  }, [amendNow])
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!canCommit) return
    setBusy(true)
    setError(null)
    window.mendel['commit:create']({ repo, summary, description, amend: amending }).then(
      () => {
        setSummary('')
        setDescription('')
        setAmend(false)
        if (!rebasing) {
          setBusy(false)
          for (const key of ['status', 'diff', 'commitInfo']) void qc.invalidateQueries({ queryKey: [key, repo] })
          return
        }
        window.mendel['conflict:continue']({ repo })
          .catch((err: Error) => setError(err.message))
          .finally(() => (setBusy(false), refreshRepo(qc, repo)))
      },
      (err: Error) => {
        setBusy(false)
        setError(err.message) // message text stays in the fields
      }
    )
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
  }
  const branch = info.data?.branch
  const descriptionClass = settings?.descriptionRuler ? `${s.description} ${s.ruler}` : s.description
  const commitLabel = rebasing ? 'Commit and continue rebase' : amending ? 'Amend last commit' : branch ? `Commit to ${branch}` : 'Commit'

  return (
    <>
      <form className={s.commitBox} onSubmit={submit} onKeyDown={onKeyDown} aria-label="Commit">
        <TextField aria-label="Summary" value={summary} onChange={setSummary} className={s.summaryField}>
          <Input placeholder="Summary (required)" className={s.summary} spellCheck={settings?.spellcheck} />
          <span className={summary.length > limit ? s.over : s.counter} data-tip={`Keep summaries under ${limit} characters`}>
            {limit - summary.length}
          </span>
        </TextField>
        <TextField aria-label="Description" value={description} onChange={setDescription} className={s.descriptionField}>
          <TextArea
            placeholder="Description"
            rows={5}
            className={descriptionClass}
            data-ruler={settings?.descriptionRuler || undefined}
            spellCheck={settings?.spellcheck}
          />
          <Button className={`ghost ${s.expand}`} aria-label="Edit message in a larger editor" onPress={() => setEditing(true)}>
            <Maximize2 size={13} aria-hidden />
          </Button>
        </TextField>
        {/* Amending mid-operation would fold the resolution into the previous commit. */}
        <Checkbox isSelected={amend} onChange={toggleAmend} isDisabled={head === null || op !== null} className={s.amend}>
          <span className={s.box} aria-hidden>
            {amend ? '✓' : ''}
          </span>
          Amend last commit
        </Checkbox>
        {hint && <small className={s.author}>{hint.note}</small>}
        {amend && hint?.amend && <small className={s.author}>{hint.amend}</small>}
        {hint?.fix && (
          <Button
            isDisabled={busy}
            onPress={() => {
              setBusy(true)
              setError(null)
              hint.fix!.run().catch((err: Error) => setError(err.message)).finally(() => setBusy(false))
            }}
          >
            {hint.fix.label}
          </Button>
        )}
        {error && (
          <p role="alert" className={s.commitError}>
            {error}
          </p>
        )}
        <Button type="submit" className={op ? undefined : 'primary'} isDisabled={!canCommit}>
          {/* a long branch name ends in an ellipsis on the span (the full label shows in the tooltip) */}
          <span className={s.commitLabel}>
            {commitLabel}
          </span>
        </Button>
        {info.data?.author && <small className={s.author}>Committing as {info.data.author}</small>}
      </form>
      {/* Outside the form: portal events still bubble through the React tree, and the box's Mod+Enter commits. */}
      <AnimatePresence>
        {editing && (
          <MessageEditor
            summary={summary}
            description={description}
            amend={amending}
            limit={limit}
            spellcheck={settings?.spellcheck}
            ruler={settings?.descriptionRuler}
            descriptionClass={descriptionClass}
            onDone={(sum, desc) => (setSummary(sum), setDescription(desc), setEditing(false))}
            onClose={() => setEditing(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** Larger editor for the commit message: edits a copy; Done (or Mod+Enter) writes it back to the box, Cancel/Escape discards. */
function MessageEditor(p: {
  summary: string
  description: string
  amend: boolean
  limit: number
  spellcheck?: boolean
  ruler?: boolean
  descriptionClass: string
  onDone(summary: string, description: string): void
  onClose(): void
}) {
  const [summary, setSummary] = useState(p.summary)
  const [description, setDescription] = useState(p.description)
  const done = (e?: FormEvent) => (e?.preventDefault(), p.onDone(summary, description))
  return (
    <DialogShell isDismissable onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Dialog className={`${a.dialog} ${s.messageDialog}`} aria-labelledby="message-title">
        <form onSubmit={done} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && done(e)} className={`${a.form} ${s.messageForm}`}>
          <Heading slot="title" id="message-title">
            Edit commit message
          </Heading>
          <TextField aria-label="Summary" value={summary} onChange={setSummary} autoFocus className={s.summaryField}>
            <Input placeholder="Summary (required)" className={s.summary} spellCheck={p.spellcheck} />
            <span className={summary.length > p.limit ? s.over : s.counter} data-tip={`Keep summaries under ${p.limit} characters`}>
              {p.limit - summary.length}
            </span>
          </TextField>
          <TextField aria-label="Description" value={description} onChange={setDescription} className={s.messageDescription}>
            <TextArea placeholder="Description" className={p.descriptionClass} data-ruler={p.ruler || undefined} spellCheck={p.spellcheck} />
          </TextField>
          {p.amend && <small className={s.author}>Amending the last commit</small>}
          <div className={a.actions}>
            <Button onPress={p.onClose}>Cancel</Button>
            <Button type="submit" className="primary">
              Done
            </Button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
