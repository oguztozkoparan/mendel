import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Button, ListBox, ListBoxItem } from 'react-aria-components'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { GerritChange } from '../../../../shared/gerrit'
import c from '../../Changes.module.css'
import { visible } from '../../DiffView'
import s from './Gerrit.module.css'
import { diffText, fileLabel, fmtVote, shortDate, who } from './util'

const LARGE_DIFF_LINES = 5000

export type Revision = NonNullable<GerritChange['revisions']>[string] & { sha: string }
export const revisionsOf = (ch: GerritChange): Revision[] =>
  Object.entries(ch.revisions ?? {})
    .map(([sha, r]) => ({ ...r, sha }))
    .sort((x, y) => x._number - y._number)

const statusText = (st: string) => (st === 'NEW' ? 'Open' : st.charAt(0) + st.slice(1).toLowerCase())

/** Change detail (PLAN.md §3.8): header, labels, reviewers, files, side-by-side diff. */
export function ChangeDetail({ repo, number, onBack }: { repo: string; number: number; onBack(): void }) {
  const q = useQuery({ queryKey: ['gerrit', repo, 'change', number], queryFn: () => window.gitdock['gerrit:change']({ repo, change: number }) })
  const [psSel, setPs] = useState<number | null>(null)
  const [base, setBase] = useState<number | undefined>(undefined)
  const [picked, setPicked] = useState<string | null>(null)
  const ch = q.data
  const revs = ch ? revisionsOf(ch) : []
  const current = revs.find((r) => r.sha === ch?.current_revision) ?? revs.at(-1)
  const ps = revs.find((r) => r._number === psSel) ?? current
  const files = useQuery({
    queryKey: ['gerrit', repo, 'files', number, ps?.sha, base],
    queryFn: () => window.gitdock['gerrit:files']({ repo, change: number, revision: ps!.sha, base }),
    enabled: !!ps
  })

  if (q.error)
    return (
      <div className={s.card} role="alert">
        <p>{q.error.message}</p>
        <Button onPress={onBack}>Back</Button>
      </div>
    )
  if (!ch || !ps) return <div className={s.skeleton} aria-label="Loading change" />

  const paths = Object.keys(files.data ?? {}).sort((x, y) => Number(!x.startsWith('/')) - Number(!y.startsWith('/')) || x.localeCompare(y))
  const file = paths.includes(picked ?? '') ? picked! : paths[0]
  const projectPath = ch.project.split('/').map(encodeURIComponent).join('/')

  return (
    <div className={s.detail}>
      <header className={s.detailHeader}>
        <h2>{ch.subject}</h2>
        <div className={s.meta}>
          <Button className={s.link} aria-label={`Open #${ch._number} in browser`} onPress={() => void window.gitdock['gerrit:open']({ repo, path: `c/${projectPath}/+/${ch._number}` })}>
            #{ch._number}
          </Button>{' '}
          · <span aria-label="Status">{statusText(ch.status)}</span>
          {ch.work_in_progress && ' · WIP'} · {who(ch.owner)} · {ch.branch}
          {ch.topic && ` · topic ${ch.topic}`} · updated {shortDate(ch.updated)}
        </div>
        <div className={s.toolbarRow}>
          <label>
            Compare{' '}
            <select aria-label="Base" value={base ?? ''} onChange={(e) => setBase(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">Base</option>
              {revs
                .filter((r) => r._number < ps._number)
                .map((r) => (
                  <option key={r.sha} value={r._number}>
                    PS {r._number}
                  </option>
                ))}
            </select>
          </label>
          ↔
          <select
            aria-label="Patch set"
            value={ps._number}
            onChange={(e) => {
              const n = Number(e.target.value)
              setPs(n)
              if (base && base >= n) setBase(undefined)
            }}
          >
            {revs.map((r) => (
              <option key={r.sha} value={r._number}>
                PS {r._number}
                {r.sha === ch.current_revision ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section aria-label="Labels" className={s.block}>
        {Object.entries(ch.labels ?? {}).map(([name, l]) => {
          const votes = (l.all ?? []).filter((v) => v.value)
          return (
            <div key={name} className={s.labelRow}>
              <strong>{name}</strong>
              {votes.length ? votes.map((v) => <span key={v._account_id ?? v.username} className={s.vote} data-vote={Math.sign(v.value!)}>{`${who(v)} ${fmtVote(v.value!)}`}</span>) : <span className={s.meta}>No votes</span>}
            </div>
          )
        })}
        <div className={s.labelRow}>
          <strong>Reviewers</strong>
          <span>{[...(ch.reviewers?.REVIEWER ?? []), ...(ch.reviewers?.CC ?? [])].map(who).join(', ') || 'None'}</span>
        </div>
      </section>

      <ListBox
        aria-label="Files"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={file ? [file] : []}
        onSelectionChange={(k) => k !== 'all' && k.size && setPicked(String([...k][0]))}
        className={s.files}
      >
        {paths.map((p) => {
          const f = files.data![p]
          return (
            <ListBoxItem key={p} id={p} textValue={fileLabel(p)} className={s.fileRow}>
              {f.status && <span className={c.letter} data-status={f.status}>{f.status}</span>}
              <span className={c.path}>{fileLabel(p)}</span>
              <span className={s.added}>+{f.lines_inserted ?? 0}</span>
              <span className={s.deleted}>−{f.lines_deleted ?? 0}</span>
            </ListBoxItem>
          )
        })}
      </ListBox>

      {file && <FileDiff key={`${ps.sha}-${base}-${file}`} repo={repo} number={number} rev={ps.sha} base={base} path={file} binary={!!files.data?.[file]?.binary} />}
    </div>
  )
}

function FileDiff(p: { repo: string; number: number; rev: string; base?: number; path: string; binary: boolean }) {
  const q = useQuery({
    queryKey: ['gerrit', p.repo, 'diff', p.number, p.rev, p.base, p.path],
    queryFn: () => window.gitdock['gerrit:diff']({ repo: p.repo, change: p.number, revision: p.rev, path: p.path, base: p.base }),
    enabled: !p.binary
  })
  const parsed = useMemo(() => (q.data && !q.data.binary ? parseDiff(diffText(q.data))[0] : undefined), [q.data])
  const [showLarge, setShowLarge] = useState(false)
  const lines = parsed?.hunks.reduce((n, h) => n + h.changes.length, 0) ?? 0

  let body
  if (p.binary || q.data?.binary) body = <p className={c.empty}>Binary file changed</p>
  else if (q.error) body = <p role="alert" className={c.empty}>{q.error.message}</p>
  else if (!parsed) body = <div className={s.skeleton} />
  else if (!parsed.hunks.length) body = <p className={c.empty}>No content changes</p>
  else if (lines > LARGE_DIFF_LINES && !showLarge)
    body = (
      <p className={c.empty}>
        Large diff hidden ({lines} lines). <Button onPress={() => setShowLarge(true)}>Show anyway</Button>
      </p>
    )
  else
    body = (
      <Diff viewType="split" diffType={parsed.type} hunks={visible(parsed.hunks)} className={c.diff}>
        {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    )

  return (
    <section aria-label={`Diff of ${fileLabel(p.path)}`} className={c.diffPane}>
      <div className={c.fileHeader}>
        <h2>{fileLabel(p.path)}</h2>
      </div>
      {body}
    </section>
  )
}
