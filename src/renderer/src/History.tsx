import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Collection, GridList, GridListItem, GridListLoadMoreItem, Input, Label, ListBox, ListBoxItem, ListLayout, SearchField, TextField, Virtualizer } from 'react-aria-components'
import { Diff, Hunk } from 'react-diff-view'
import type { CommitDetail, CommitSummary } from '../../shared/ipc'
import a from './App.module.css'
import { refreshRepo, useBranches } from './Branches'
import c from './Changes.module.css'
import { useParsedDiff, visible } from './DiffView'
import { bannerError, ErrorBanner, type BannerError } from './ErrorBanner'
import s from './History.module.css'
import { ago } from './time'

const PAGE = 100

/**
 * History tab (PLAN.md 3.6): current (or picked) branch's commits (pages of 100, virtualized) and the selected commit's detail.
 * Current branch: Revert a commit; another branch: Cherry-pick a commit onto the current one.
 * `decorate` adds per-row content, e.g. a provider badge ("in review #1234").
 */
export function HistoryView(p: { repo: string; decorate?: (c: CommitSummary) => ReactNode; onAmend?: () => void }) {
  const branches = useBranches(p.repo)
  /** '' = current branch. */
  const [ref, setRef] = useState('')
  // Picked branch deleted, or checked out (now current): back to the current branch.
  const br = branches.data
  if (ref && br && !(br.remote.includes(ref) || br.local.some((x) => x.name === ref && x.name !== br.current))) setRef('')
  // Keyed by HEAD: a new commit/checkout starts a fresh first page, and `--skip` pages stay consistent within one HEAD.
  // Not stale on its own (no all-pages refetch on focus); refreshRepo trims it to page 1 before invalidating.
  // Applied filters (search fields apply on Enter, not per keystroke); empty = unfiltered.
  const [filter, setFilter] = useState<{ grep?: string; author?: string; path?: string }>({})
  const set = (k: keyof typeof filter, v: string) => setFilter((f) => ({ ...f, [k]: v.trim() || undefined }))
  const filtered = !!(filter.grep || filter.author || filter.path)
  const q = useInfiniteQuery({
    queryKey: ['history', p.repo, branches.data?.head, ref, filter],
    queryFn: ({ pageParam }) => window.mendel['history:log']({ repo: p.repo, skip: pageParam, ref: ref || undefined, ...filter }),
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
        <select aria-label="History branch" className={s.branch} value={ref} onChange={(e) => setRef(e.target.value)}>
          <option value="">Current branch{branches.data?.current ? ` (${branches.data.current})` : ''}</option>
          {branches.data?.local.filter((b) => b.name !== branches.data?.current).map((b) => <option key={b.name}>{b.name}</option>)}
          {branches.data?.remote.map((b) => <option key={b}>{b}</option>)}
        </select>
        <div className={s.filters}>
          <SearchField aria-label="Search messages" onSubmit={(v) => set('grep', v)} onClear={() => set('grep', '')}>
            <Input placeholder="Search messages" />
          </SearchField>
          <SearchField aria-label="Filter by author" onSubmit={(v) => set('author', v)} onClear={() => set('author', '')}>
            <Input placeholder="Author" />
          </SearchField>
          {filter.path && (
            <p className={s.fileFilter}>
              <span>
                History of <code>{filter.path}</code>
              </span>
              <Button onPress={() => set('path', '')}>All files</Button>
            </p>
          )}
        </div>
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 44 }}>
          <GridList
            aria-label="Commits"
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            selectedKeys={selected ? [selected.sha] : []}
            onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
            className={c.list}
            renderEmptyState={() => (q.data ? <p className={c.empty}>{filtered ? 'No matching commits' : 'No commits yet'}</p> : null)}
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
            // Amend only HEAD, and only while it is unpushed (PLAN.md 3.6); a filtered list's first row need not be HEAD.
            <CommitView
              key={selected.sha}
              repo={p.repo}
              sha={selected.sha}
              pick={ref ? 'cherry-pick' : 'revert'}
              onAmend={!ref && !filtered && selected === commits[0] && selected.unpushed ? p.onAmend : undefined}
              // Blame jumps only to commits already loaded in the list.
              onPick={(sha) => commits.some((x) => x.sha === sha) && setPicked(sha)}
              onFileHistory={(path) => set('path', path)}
            />
          )
        )}
      </section>
    </>
  )
}

/** Stashes tab: all stashes; the selected one's diff (vs. the commit it was made on; untracked files not shown), Apply / Pop / Drop…. */
export function StashesView(p: { repo: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['stashes', p.repo], queryFn: () => window.mendel['stash:list']({ repo: p.repo }) })
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<BannerError | null>(null)
  const stashes = q.data ?? []
  const selected = stashes.find((x) => x.sha === picked) ?? stashes[0]
  const act = (action: 'apply' | 'pop' | 'drop') => {
    if (!selected) return
    setError(null)
    void window.mendel['stash:action']({ repo: p.repo, sha: selected.sha, action })
      .catch((e) => setError(bannerError(e)))
      .finally(() => refreshRepo(qc, p.repo))
  }
  return (
    <>
      <aside className={a.side}>
        <GridList
          aria-label="Stashes"
          items={stashes}
          selectionMode="single"
          selectionBehavior="replace"
          disallowEmptySelection
          selectedKeys={selected ? [selected.sha] : []}
          onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
          className={c.list}
          renderEmptyState={() => (q.data ? <p className={c.empty}>No stashes</p> : null)}
        >
          {(x) => (
            <GridListItem id={x.sha} textValue={x.message} className={s.row}>
              <span className={s.summary}>{x.message}</span>
              <small className={s.meta}>{ago(x.date)}</small>
            </GridListItem>
          )}
        </GridList>
      </aside>
      <section className={a.main}>
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {q.error ? (
          <p role="alert" className={c.empty}>
            {q.error.message}
          </p>
        ) : (
          selected && (
            <>
              <div className={c.fileHeader}>
                <Button onPress={() => act('apply')}>Apply</Button>
                <Button onPress={() => act('pop')}>Pop</Button>
                <Button onPress={() => act('drop')}>Drop…</Button>
              </div>
              <CommitView key={selected.sha} repo={p.repo} sha={selected.sha} />
            </>
          )
        )}
      </section>
    </>
  )
}

function CommitView(p: { repo: string; sha: string; pick?: 'cherry-pick' | 'revert'; onAmend?: () => void; onPick?: (sha: string) => void; onFileHistory?(path: string): void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['commit', p.repo, p.sha], queryFn: () => window.mendel['history:commit']({ repo: p.repo, sha: p.sha }) })
  const [file, setFile] = useState<string | null>(null)
  const [blame, setBlame] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A conflict needs nothing here: refreshRepo refetches conflict state and the banner takes over.
  const pick = () => {
    setBusy(true)
    setError(null)
    void window.mendel['history:pick']({ repo: p.repo, sha: p.sha, op: p.pick! })
      .catch((e: { message?: string }) => setError(e.message ?? String(e)))
      .finally(() => (setBusy(false), refreshRepo(qc, p.repo)))
  }
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
      {/* Merge commits need a mainline (-m): not offered. */}
      {p.pick && d.parents.length < 2 && (
        <Button isDisabled={busy} onPress={pick}>
          {p.pick === 'revert' ? 'Revert commit' : 'Cherry-pick onto current branch'}
        </Button>
      )}
      {error && <p role="alert" className={c.empty}>{error}</p>}
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
        <dt>Tags</dt>
        <dd>
          <CommitTags repo={p.repo} sha={d.sha} />
        </dd>
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
      {f && p.onFileHistory && (
        <Button className={s.fileHistory} onPress={() => p.onFileHistory?.(f.path)}>
          File history
        </Button>
      )}
      {/* A deleted file has nothing to blame at this commit. */}
      {f && f.status !== 'D' && (
        <div>
          <Button onPress={() => setBlame(!blame)}>{blame ? 'Show diff' : 'Blame'}</Button>
        </div>
      )}
      {f && (blame && f.status !== 'D' ? <BlameView key={f.path} repo={p.repo} sha={d.sha} path={f.path} onPick={p.onPick} /> : <CommitFileDiff repo={p.repo} sha={d.sha} file={f} />)}
    </div>
  )
}

/** Tags on this commit (Push / Delete) and a small create form; a message makes the tag annotated. */
function CommitTags(p: { repo: string; sha: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['tags', p.repo], queryFn: () => window.mendel['tag:list']({ repo: p.repo }) })
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = (op: Promise<unknown>) => {
    setError(null)
    return op.then(
      () => refreshRepo(qc, p.repo),
      (err: Error) => setError(err.message)
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(window.mendel['tag:create']({ repo: p.repo, name: name.trim(), sha: p.sha, message: message.trim() || undefined }).then(() => (setName(''), setMessage(''))))
  }
  return (
    <>
      {q.data
        ?.filter((t) => t.sha === p.sha)
        .map((t) => (
          <span key={t.name} aria-label={`Tag ${t.name}`}>
            <code>{t.name}</code> <Button onPress={() => void run(window.mendel['tag:push']({ repo: p.repo, name: t.name }))}>Push</Button>{' '}
            <Button onPress={() => void run(window.mendel['tag:delete']({ repo: p.repo, name: t.name }))}>Delete…</Button>{' '}
          </span>
        ))}
      <form onSubmit={submit} aria-label="Create tag">
        <TextField value={name} onChange={setName} aria-label="Tag name">
          <Input placeholder="Tag name" spellCheck={false} />
        </TextField>
        <TextField value={message} onChange={setMessage}>
          <Label className={a.muted}>Message (optional, annotated)</Label>
          <Input spellCheck={false} />
        </TextField>
        <Button type="submit" isDisabled={!name.trim()}>
          Create tag
        </Button>
      </form>
      {error && (
        <p role="alert" className={a.error}>
          {error}
        </p>
      )}
    </>
  )
}

/** `git blame` of one file as of a commit; activating a line selects its commit in the list. */
function BlameView(p: { repo: string; sha: string; path: string; onPick?: (sha: string) => void }) {
  const q = useQuery({ queryKey: ['blame', p.repo, p.sha, p.path], queryFn: () => window.mendel['history:blame']({ repo: p.repo, sha: p.sha, path: p.path }) })
  const rows = useMemo(() => q.data?.map((x, i) => ({ ...x, id: i })) ?? [], [q.data])
  if (q.error) return <p role="alert" className={c.empty}>{q.error.message}</p>
  if (!q.data) return null
  return (
    <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 20 }}>
      <GridList aria-label="Blame" items={rows} onAction={(k) => p.onPick?.(rows[Number(k)]!.sha)} className={s.blame}>
        {(x) => (
          <GridListItem id={x.id} textValue={`${x.sha.slice(0, 7)} ${x.author} ${x.text}`} className={s.blameRow}>
            <span className={s.blameWho}>
              <code>{x.sha.slice(0, 7)}</code> {x.author} · {ago(x.date)}
            </span>
            <span className={s.blameNo}>{x.id + 1}</span>
            <span>{x.text}</span>
          </GridListItem>
        )}
      </GridList>
    </Virtualizer>
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
