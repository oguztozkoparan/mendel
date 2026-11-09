import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, Checkbox, Input, TextArea, TextField } from 'react-aria-components'
import { refreshRepo } from './Branches'
import s from './Changes.module.css'
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
  // Same query as the conflict banner: while a rebase is stopped, Continue there is the primary and this commit also continues.
  const rebasing = useQuery({ queryKey: ['conflict', repo], queryFn: () => window.mendel['conflict:state']({ repo }) }).data === 'rebase'
  const settings = useSettings().data
  const limit = settings?.summaryLimit ?? 72
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const head = info.data?.head ?? null
  const canCommit = !busy && summary.trim() !== '' && (hasStaged || amend)

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
    window.mendel['commit:create']({ repo, summary, description, amend }).then(
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

  return (
    <form className={s.commitBox} onSubmit={submit} onKeyDown={onKeyDown} aria-label="Commit">
      <TextField aria-label="Summary" value={summary} onChange={setSummary} className={s.summaryField}>
        <Input placeholder="Summary (required)" className={s.summary} spellCheck={settings?.spellcheck} />
        <span className={summary.length > limit ? s.over : s.counter} title={`Keep summaries under ${limit} characters`}>
          {limit - summary.length}
        </span>
      </TextField>
      <TextField aria-label="Description" value={description} onChange={setDescription}>
        <TextArea
          placeholder="Description"
          rows={5}
          className={settings?.descriptionRuler ? `${s.description} ${s.ruler}` : s.description}
          data-ruler={settings?.descriptionRuler || undefined}
          spellCheck={settings?.spellcheck}
        />
      </TextField>
      <Checkbox isSelected={amend} onChange={toggleAmend} isDisabled={head === null} className={s.amend}>
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
      <Button type="submit" className={rebasing ? undefined : 'primary'} isDisabled={!canCommit}>
        {rebasing ? 'Commit and continue rebase' : amend ? 'Amend last commit' : branch ? `Commit to ${branch}` : 'Commit'}
      </Button>
      {info.data?.author && <small className={s.author}>Committing as {info.data.author}</small>}
    </form>
  )
}
