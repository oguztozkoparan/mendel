import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Button, ListBox, ListBoxItem } from 'react-aria-components'
import {
  computeNewLineNumber,
  computeOldLineNumber,
  Diff,
  findChangeByNewLineNumber,
  findChangeByOldLineNumber,
  getChangeKey,
  Hunk,
  type HunkData
} from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { GerritChange, GerritComment } from '../../../../shared/gerrit'
import c from '../../Changes.module.css'
import { useParsedDiff, visible } from '../../DiffView'
import { AttentionHashtags } from './AttentionHashtags'
import { ChangeActions } from './ChangeActions'
import { Composer, DraftView, Thread, usePending, type Pending, type PendingStore } from './Comments'
import s from './Gerrit.module.css'
import { ReplyDialog } from './ReplyDialog'
import { diffText, fileLabel, fmtVote, shortDate, threadsOf, who } from './util'

export type Revision = NonNullable<GerritChange['revisions']>[string] & { sha: string }
export const revisionsOf = (ch: GerritChange): Revision[] =>
  Object.entries(ch.revisions ?? {})
    .map(([sha, r]) => ({ ...r, sha }))
    .sort((x, y) => x._number - y._number)

const statusText = (st: string) => (st === 'NEW' ? 'Open' : st.charAt(0) + st.slice(1).toLowerCase())

/** Change detail (PLAN.md §3.8): header, labels, reviewers, related changes, files, side-by-side diff with comment threads. */
export function ChangeDetail({ repo, number, me, onBack, onOpen }: { repo: string; number: number; me: string | null; onBack(): void; onOpen(change: number): void }) {
  const q = useQuery({ queryKey: ['gerrit', repo, 'change', number], queryFn: () => window.mendel['gerrit:change']({ repo, change: number }) })
  const [psSel, setPs] = useState<number | null>(null)
  const [base, setBase] = useState<number | undefined>(undefined)
  const [picked, setPicked] = useState<string | null>(null)
  const ch = q.data
  const revs = ch ? revisionsOf(ch) : []
  const current = revs.find((r) => r.sha === ch?.current_revision) ?? revs.at(-1)
  const ps = revs.find((r) => r._number === psSel) ?? current
  const files = useQuery({
    queryKey: ['gerrit', repo, 'files', number, ps?.sha, base],
    queryFn: () => window.mendel['gerrit:files']({ repo, change: number, revision: ps!.sha, base }),
    enabled: !!ps
  })
  const comments = useQuery({ queryKey: ['gerrit', repo, 'comments', number], queryFn: () => window.mendel['gerrit:comments']({ repo, change: number }) })
  const related = useQuery({ queryKey: ['gerrit', repo, 'related', number], queryFn: () => window.mendel['gerrit:related']({ repo, change: number }) })
  const pending = usePending(repo, number)
  const [replying, setReplying] = useState(false)

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
  // Shown: this patch set's comments (+ its PARENT side when comparing against Base), or the base patch set's on the left.
  const shown = (comments.data ?? []).filter(
    (cm) => (cm.patch_set === ps._number && (cm.side !== 'PARENT' || !base)) || (!!base && cm.patch_set === base && cm.side !== 'PARENT')
  )
  const isCurrent = ps.sha === ch.current_revision

  return (
    <div className={s.detail}>
      <header className={s.detailHeader}>
        <h2>{ch.subject}</h2>
        <div className={s.meta}>
          <Button className={s.link} aria-label={`Open #${ch._number} in browser`} onPress={() => void window.mendel['gerrit:open']({ repo, path: `c/${projectPath}/+/${ch._number}` })}>
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
        <div className={s.toolbarRow}>
          <Button className="primary" onPress={() => setReplying(true)}>
            Reply…{pending.list.length ? ` (${pending.list.length} pending)` : ''}
          </Button>
          <ChangeActions repo={repo} change={ch} current={current} ps={ps._number} />
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
        <AttentionHashtags repo={repo} change={ch} me={me} />
      </section>

      {!!related.data?.length && (
        <section aria-label="Related changes" className={s.block}>
          <strong>Related changes</strong>
          <ul className={s.related}>
            {related.data.map((r) => {
              const n = r._change_number
              const self = n === ch._number
              const subject = r.commit.subject ?? r.commit.commit.slice(0, 7)
              const outdated = !!r._revision_number && !!r._current_revision_number && r._revision_number < r._current_revision_number
              return (
                <li key={r.commit.commit} aria-current={self || undefined}>
                  {n && !self ? (
                    <Button className={s.link} onPress={() => onOpen(n)}>
                      {subject}
                    </Button>
                  ) : (
                    <span>{subject}</span>
                  )}
                  <span className={s.meta}>
                    {n ? ` #${n}` : ''}
                    {r.status ? ` · ${statusText(r.status)}` : ''}
                    {outdated ? ` · Outdated (PS ${r._revision_number} of ${r._current_revision_number})` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

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
              {shown.some((cm) => cm.path === p) && <span className={s.meta}>{`${shown.filter((cm) => cm.path === p).length} comments`}</span>}
            </ListBoxItem>
          )
        })}
      </ListBox>

      {file && (
        <FileDiff
          key={`${ps.sha}-${base}-${file}`}
          repo={repo}
          number={number}
          rev={ps.sha}
          ps={ps._number}
          base={base}
          path={file}
          binary={!!files.data?.[file]?.binary}
          comments={shown.filter((cm) => cm.path === file)}
          pending={pending}
          canComment={{ old: isCurrent && !base, new: isCurrent }}
        />
      )}
      {replying && current && <ReplyDialog repo={repo} change={ch} patchSet={current._number} me={me} pending={pending} onClose={() => setReplying(false)} />}
    </div>
  )
}

type Side = 'old' | 'new'
type FileDiffProps = {
  repo: string
  number: number
  rev: string
  ps: number
  base?: number
  path: string
  binary: boolean
  comments: GerritComment[]
  pending: PendingStore
  /** New comments only on the current patch set (the reply posts there); left side only against Base (PARENT). */
  canComment: Record<Side, boolean>
}

function FileDiff(p: FileDiffProps) {
  const q = useQuery({
    queryKey: ['gerrit', p.repo, 'diff', p.number, p.rev, p.base, p.path],
    queryFn: () => window.mendel['gerrit:diff']({ repo: p.repo, change: p.number, revision: p.rev, path: p.path, base: p.base }),
    enabled: !p.binary
  })
  const raw = useMemo(() => (q.data && !q.data.binary ? diffText(q.data) : undefined), [q.data])
  const { parsed, gate } = useParsedDiff(raw)
  const [composing, setComposing] = useState<{ side: Side; line: number } | null>(null)

  // Anchor threads, new drafts and the open composer to diff rows; anything unanchored is shown above the diff.
  const hunks = useMemo(() => (parsed ? visible(parsed.hunks) : []), [parsed])
  const sideOf = (x: { side?: string; patch_set?: number }): Side => (x.side === 'PARENT' || (!!p.base && x.patch_set === p.base) ? 'old' : 'new')
  const keyOf = (side: Side, line?: number) => {
    const ch = line ? (side === 'old' ? findChangeByOldLineNumber(hunks, line) : findChangeByNewLineNumber(hunks, line)) : undefined
    return ch ? getChangeKey(ch) : ''
  }
  const drafts = p.pending.list.filter((d) => !d.in_reply_to && d.path === p.path && d.patch_set === p.ps && (d.side !== 'PARENT' || !p.base))
  const items = new Map<string, ReactNode[]>()
  const put = (key: string, node: ReactNode) => items.set(key, [...(items.get(key) ?? []), node])
  for (const t of threadsOf(p.comments)) put(keyOf(sideOf(t[0]), t[0].line), <Thread key={t[0].id} repo={p.repo} thread={t} fallbackPs={p.ps} pending={p.pending} />)
  for (const d of drafts) put(keyOf(d.side === 'PARENT' ? 'old' : 'new', d.line), <DraftView key={d.key} draft={d} onRemove={() => p.pending.remove(d.key)} />)
  if (composing) {
    const { side, line } = composing
    put(
      keyOf(side, line),
      <Composer
        key="composer"
        label={`Comment on line ${line}`}
        onCancel={() => setComposing(null)}
        onSave={(message) => {
          p.pending.add({ path: p.path, patch_set: p.ps, line, side: side === 'old' ? 'PARENT' : undefined, message, unresolved: true } satisfies Omit<Pending, 'key'>)
          setComposing(null)
        }}
      />
    )
  }
  const widgets = Object.fromEntries([...items].filter(([k]) => k).map(([k, nodes]) => [k, <div className={s.widgets}>{nodes}</div>]))
  const gutterEvents = {
    onClick: ({ side, change }: { side?: Side; change: HunkData['changes'][number] | null }) => {
      if (!side || !change || !p.canComment[side]) return
      const line = side === 'old' ? computeOldLineNumber(change) : computeNewLineNumber(change)
      if (line > 0) setComposing({ side, line })
    }
  }

  let body
  if (p.binary || q.data?.binary) body = <p className={c.empty}>Binary file changed</p>
  else if (q.error) body = <p role="alert" className={c.empty}>{q.error.message}</p>
  else if (gate) body = gate
  else if (!parsed) body = <div className={s.skeleton} />
  else if (!parsed.hunks.length) body = <p className={c.empty}>No content changes</p>
  else
    body = (
      <Diff viewType="split" diffType={parsed.type} hunks={hunks} widgets={widgets} gutterEvents={gutterEvents} className={c.diff}>
        {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    )

  return (
    <section aria-label={`Diff of ${fileLabel(p.path)}`} className={c.diffPane}>
      <div className={c.fileHeader}>
        <h2>{fileLabel(p.path)}</h2>
      </div>
      {!!items.get('')?.length && <div className={s.widgets}>{items.get('')}</div>}
      {body}
    </section>
  )
}
