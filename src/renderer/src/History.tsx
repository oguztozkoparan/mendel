import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { Button, Collection, GridList, GridListItem, GridListLoadMoreItem, ListBox, ListBoxItem, ListLayout, Virtualizer } from 'react-aria-components'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import type { CommitDetail, CommitSummary } from '../../shared/ipc'
import a from './App.module.css'
import c from './Changes.module.css'
import { visible } from './DiffView'
import s from './History.module.css'
import { ago } from './time'

const PAGE = 100

/**
 * History tab (PLAN.md 3.6): current branch's commits (pages of 100, virtualized) and the selected commit's detail.
 * `decorate` adds per-row content, e.g. a provider badge ("in review #1234").
 */
export function HistoryView(p: { repo: string; decorate?: (c: CommitSummary) => ReactNode }) {
  const q = useInfiniteQuery({
    queryKey: ['history', p.repo],
    queryFn: ({ pageParam }) => window.gitdock['history:log']({ repo: p.repo, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined)
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
            <Collection items={commits}>
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
          selected && <CommitView key={selected.sha} repo={p.repo} sha={selected.sha} />
        )}
      </section>
    </>
  )
}

function CommitView(p: { repo: string; sha: string }) {
  const q = useQuery({ queryKey: ['commit', p.repo, p.sha], queryFn: () => window.gitdock['history:commit']({ repo: p.repo, sha: p.sha }) })
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
          <Button onPress={() => void window.gitdock['app:copy']({ text: d.sha }).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</Button>
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
      {f && <CommitFileDiff repo={p.repo} sha={d.sha} file={f} />}
    </div>
  )
}

function CommitFileDiff(p: { repo: string; sha: string; file: CommitDetail['files'][number] }) {
  const q = useQuery({
    queryKey: ['commitDiff', p.repo, p.sha, p.file.path],
    queryFn: () => window.gitdock['history:diff']({ repo: p.repo, sha: p.sha, path: p.file.path, origPath: p.file.origPath })
  })
  const parsed = useMemo(() => (q.data ? parseDiff(q.data)[0] : undefined), [q.data])
  if (q.error) return <p role="alert" className={c.empty}>{q.error.message}</p>
  if (!q.data) return null
  if (parsed?.isBinary || /^Binary files /m.test(q.data)) return <p className={c.empty}>Binary file changed</p>
  if (!parsed?.hunks.length) return <p className={c.empty}>No content changes</p>
  return (
    <section className={c.diffPane} aria-label="Commit diff">
      <Diff viewType="unified" diffType={parsed.type} hunks={visible(parsed.hunks)} className={c.diff}>
        {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    </section>
  )
}
