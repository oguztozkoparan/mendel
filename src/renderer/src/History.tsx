import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Button, Collection, GridList, GridListItem, GridListLoadMoreItem, ListBox, ListBoxItem, ListLayout, Virtualizer } from 'react-aria-components'
import { Diff, Hunk } from 'react-diff-view'
import type { CommitDetail, CommitSummary } from '../../shared/ipc'
import a from './App.module.css'
import { useBranches } from './Branches'
import c from './Changes.module.css'
import { useParsedDiff, visible } from './DiffView'
import s from './History.module.css'
import { ago } from './time'

const PAGE = 100

/**
 * History tab (PLAN.md 3.6): current branch's commits (pages of 100, virtualized) and the selected commit's detail.
 * `decorate` adds per-row content, e.g. a provider badge ("in review #1234").
 */
export function HistoryView(p: { repo: string; decorate?: (c: CommitSummary) => ReactNode; onAmend?: () => void }) {
  const branches = useBranches(p.repo)
  // Keyed by HEAD: a new commit/checkout starts a fresh first page, and `--skip` pages stay consistent within one HEAD.
  // Not stale on its own (no all-pages refetch on focus); refreshRepo trims it to page 1 before invalidating.
  const q = useInfiniteQuery({
    queryKey: ['history', p.repo, branches.data?.head],
    queryFn: ({ pageParam }) => window.mendel['history:log']({ repo: p.repo, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
    enabled: !!branches.data,
    staleTime: Infinity,
    placeholderData: keepPreviousData
  })
  const commits = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = commits.find((x) => x.sha === picked) ?? commits[0]

  return (
    <>
      <aside className={a.side}>
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 44 }}>
          <GridList
            aria-label="Commits"
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            selectedKeys={selected ? [selected.sha] : []}
            onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
            className={c.list}
            renderEmptyState={() => (q.data ? <p className={c.empty}>No commits yet</p> : null)}
          >
            <Collection items={commits} dependencies={[p.decorate]}>
              {(x) => (
                <GridListItem id={x.sha} textValue={x.summary} className={s.row}>
                  <span className={s.summary}>{x.summary}</span>
                  <small className={s.meta}>
                    {x.author} · {ago(x.date)} · <code>{x.short}</code>
                    {x.unpushed && <span className={s.badge}>↑ unpushed</span>}
                    {p.decorate?.(x)}
                  </small>
                </GridListItem>
              )}
            </Collection>
            <GridListLoadMoreItem onLoadMore={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()} isLoading={q.isFetchingNextPage} />
          </GridList>
        </Virtualizer>
      </aside>
      <section className={a.main}>
        {q.error ? (
          <p role="alert" className={c.empty}>
            {q.error.message}
          </p>
        ) : (
          selected && (
            // Amend only HEAD, and only while it is unpushed (PLAN.md 3.6).
            <CommitView key={selected.sha} repo={p.repo} sha={selected.sha} onAmend={selected === commits[0] && selected.unpushed ? p.onAmend : undefined} />
          )
        )}
      </section>
    </>
  )
}

function CommitView(p: { repo: string; sha: string; onAmend?: () => void }) {
  const q = useQuery({ queryKey: ['commit', p.repo, p.sha], queryFn: () => window.mendel['history:commit']({ repo: p.repo, sha: p.sha }) })
  const [file, setFile] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  if (q.error) return <p role="alert" className={c.empty}>{q.error.message}</p>
  const d = q.data
  if (!d) return null
  const [summary, ...body] = d.message.split('\n')
  const f = d.files.find((x) => x.path === file) ?? d.files[0]
  const date = (ms: number) => new Date(ms).toLocaleString()
  return (
    <div className={s.detail} aria-label="Commit detail">
      <h2 className={s.title}>{summary}</h2>
      {p.onAmend && <Button onPress={p.onAmend}>Amend last commit</Button>}
      {body.join('\n').trim() && <pre className={s.message}>{body.join('\n').trim()}</pre>}
      <dl className={s.fields}>
        <dt>Author</dt>
        <dd>
          {d.author} · {date(d.authorDate)}
        </dd>
        {d.committer !== d.author && (
          <>
            <dt>Committer</dt>
            <dd>
              {d.committer} · {date(d.committerDate)}
            </dd>
          </>
        )}
        <dt>SHA</dt>
        <dd>
          <code>{d.sha}</code>{' '}
          <Button onPress={() => void window.mendel['app:copy']({ text: d.sha }).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</Button>
        </dd>
        {d.parents.length > 0 && (
          <>
            <dt>{d.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
            <dd>
              <code>{d.parents.map((x) => x.slice(0, 7)).join(' ')}</code>
            </dd>
          </>
        )}
      </dl>
      <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 26 }}>
        <ListBox
          aria-label="Changed files"
          items={d.files}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={f ? [f.path] : []}
          onSelectionChange={(keys) => keys !== 'all' && keys.size && setFile(String([...keys][0]))}
          className={s.files}
        >
          {(x) => (
            <ListBoxItem id={x.path} textValue={x.path} className={c.row}>
              <span className={c.letter} data-status={x.status}>
                {x.status}
              </span>
              <span className={c.path}>{x.origPath ? `${x.origPath} → ${x.path}` : x.path}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </Virtualizer>
      {f && <CommitFileDiff repo={p.repo} sha={d.sha} file={f} />}
    </div>
  )
}

function CommitFileDiff(p: { repo: string; sha: string; file: CommitDetail['files'][number] }) {
  const q = useQuery({
    queryKey: ['commitDiff', p.repo, p.sha, p.file.path],
    queryFn: () => window.mendel['history:diff']({ repo: p.repo, sha: p.sha, path: p.file.path, origPath: p.file.origPath })
  })
  const { parsed, gate } = useParsedDiff(q.data)
  if (q.error) return <p role="alert" className={c.empty}>{q.error.message}</p>
  if (!q.data) return null
  if (parsed?.isBinary || /^Binary files /m.test(q.data)) return <p className={c.empty}>Binary file changed</p>
  if (gate) return gate
  if (!parsed?.hunks.length) return <p className={c.empty}>No content changes</p>
  return (
    <section className={c.diffPane} aria-label="Commit diff">
      <Diff viewType="unified" diffType={parsed.type} hunks={visible(parsed.hunks)} className={c.diff}>
        {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    </section>
  )
}
