import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from 'react-aria-components'
import { HASHTAG, type GerritChange } from '../../../../shared/gerrit'
import a from '../../App.module.css'
import s from './Gerrit.module.css'
import { needsMe, who } from './util'

/** Attention set (only when the server sends one, 3.3+) and hashtags rows of the change detail's Labels block. */
export function AttentionHashtags({ repo, change: ch, me }: { repo: string; change: GerritChange; me: number | null }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const [pick, setPick] = useState('')
  const run = (p: Promise<unknown>, after?: () => void) => {
    setBusy(true)
    setError(null)
    p.then(
      () => (after?.(), void qc.invalidateQueries({ queryKey: ['gerrit', repo] })),
      (err: Error) => setError(err.message)
    ).finally(() => setBusy(false))
  }
  const attention = (account: number | 'self', add: boolean) => run(window.mendel['gerrit:attention']({ repo, change: ch._number, account, add }), () => setPick(''))
  const hashtags = (add: string[], remove: string[]) => run(window.mendel['gerrit:hashtags']({ repo, change: ch._number, add, remove }), () => setTag(''))
  const addTag = (e: FormEvent) => {
    e.preventDefault()
    const t = tag.trim().replace(/^#/, '')
    // Main validates too; this only gives a readable message instead of the IPC schema error.
    if (!HASHTAG.test(t)) return setError('A hashtag cannot be empty or contain spaces or commas')
    hashtags([t], [])
  }

  const inSet = Object.values(ch.attention_set ?? {})
  // Owner + reviewers + CC not yet in the attention set, once each.
  const candidates = [ch.owner, ...(ch.reviewers?.REVIEWER ?? []), ...(ch.reviewers?.CC ?? [])].filter(
    (x, i, all) => x._account_id && all.findIndex((y) => y._account_id === x._account_id) === i && !inSet.some((e) => e.account._account_id === x._account_id)
  )

  return (
    <>
      {ch.attention_set && (
        <div className={s.labelRow}>
          <strong>Attention</strong>
          {needsMe(ch, me) && <span className={s.attention}>Needs your attention</span>}
          <span>{inSet.map((e) => who(e.account)).join(', ') || 'None'}</span>
          {needsMe(ch, me) && (
            <Button className="ghost" isDisabled={busy} onPress={() => attention('self', false)}>
              Remove me
            </Button>
          )}
          {!!candidates.length && (
            <>
              <select aria-label="Add to attention" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
                <option value="">Add to attention…</option>
                {candidates.map((x) => (
                  <option key={x._account_id} value={x._account_id}>
                    {who(x)}
                  </option>
                ))}
              </select>
              <Button className="ghost" isDisabled={busy || !pick} onPress={() => attention(Number(pick), true)}>
                Add
              </Button>
            </>
          )}
        </div>
      )}
      <form className={s.labelRow} onSubmit={addTag}>
        <strong>Hashtags</strong>
        {(ch.hashtags ?? []).map((h) => (
          <span key={h} className={s.vote}>
            #{h}{' '}
            <Button className={s.link} aria-label={`Remove hashtag ${h}`} isDisabled={busy} onPress={() => hashtags([], [h])}>
              ×
            </Button>
          </span>
        ))}
        <input aria-label="New hashtag" placeholder="Add hashtag" value={tag} onChange={(e) => setTag(e.target.value)} disabled={busy} maxLength={100} />
        <button type="submit" className="ghost" aria-label="Add hashtag" disabled={busy || !tag.trim()}>
          Add
        </button>
      </form>
      {error && (
        <span role="alert" className={a.error}>
          {error}
        </span>
      )}
    </>
  )
}
