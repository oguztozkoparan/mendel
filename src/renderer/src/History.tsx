import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, ListTodo } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Collection, Dialog, DialogTrigger, GridList, GridListItem, GridListLoadMoreItem, Input, Label, ListBox, ListBoxItem, ListLayout, SearchField, TextField, Virtualizer } from 'react-aria-components'
import { Diff, Hunk } from 'react-diff-view'
import { hasQuery, parseHistoryQuery, QUALIFIERS, type HistoryQuery } from '../../shared/historyQuery'
import type { CommitDetail, CommitSummary } from '../../shared/ipc'
import a from './App.module.css'
import { refreshRepo, useBranches } from './Branches'
import { FileFilter, matchFile } from './Changes'
import c from './Changes.module.css'
import { useParsedDiff, visible } from './DiffView'
import { bannerError, ErrorBanner, PaneBanners, type BannerError } from './ErrorBanner'
import s from './History.module.css'
import { RebaseDialog } from './RebaseDialog'
import { Highlight, PopPopover } from './motion'
import r from './Repos.module.css'
import { ago } from './time'
import { fitRow, graphRows, type GraphRow } from './graph'
import { Trailers } from './CommitTrailers'
import { splitTrailers } from './trailers'

const PAGE = 100
/** Commit graph geometry (concept .lane: 30px column, dot centre 15px; row height as the list's). */
const ROW_H = 44
const LANE_W = 12
/** Graph columns that fit beside the row text; more concurrent lanes share the last column (fitRow). */
const MAX_LANES = 6
const LANE_COLORS = ['var(--accent)', 'var(--git-ren)', 'var(--git-mod)', 'var(--git-add)', 'var(--muted)']
const laneX = (i: number) => 15 + i * LANE_W
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length]!

/** One row's slice of the commit graph: lines in from the top, out to the bottom, straight-through lanes, and the dot (hollow ring = merge). */
function GraphCell({ row }: { row: GraphRow & { bundle: boolean } }) {
  const mid = ROW_H / 2
  const xc = laneX(row.col)
  const line = (i: number) => ({
    stroke: `color-mix(in srgb, ${laneColor(i)} 30%, transparent)`,
    strokeDasharray: row.bundle && i === MAX_LANES - 1 ? '4 6' : undefined
  })
  return (
    <svg className={s.graph} height={ROW_H} aria-hidden>
      {row.pass.map((i) => <line key={`p${i}`} x1={laneX(i)} y1={0} x2={laneX(i)} y2={ROW_H} style={line(i)} />)}
      {row.into.map((i) => <path key={`i${i}`} d={`M${laneX(i)} 0C${laneX(i)} ${mid / 2} ${xc} ${mid / 2} ${xc} ${mid}`} style={line(i)} />)}
      {row.out.map((j) => <path key={`o${j}`} d={`M${xc} ${mid}C${xc} ${mid * 1.5} ${laneX(j)} ${mid * 1.5} ${laneX(j)} ${ROW_H}`} style={line(j)} />)}
      <circle cx={xc} cy={mid} r={6} className={row.merge ? s.merge : undefined} style={{ ['--c' as string]: laneColor(row.col) }} />
    </svg>
  )
}

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
  // `path` = the File history button (wins over a `path:` in the search).
  const [filter, setFilter] = useState<{ query?: HistoryQuery; path?: string }>({})
  const [queryErrors, setQueryErrors] = useState<string[]>([])
  // An invalid search keeps the last applied filter and shows why.
  const search = (v: string) => {
    const { query, errors } = parseHistoryQuery(v)
    setQueryErrors(errors)
    if (!errors.length) setFilter((f) => ({ ...f, query: hasQuery(query) ? query : undefined }))
  }
  const setPath = (path?: string) => setFilter((f) => ({ ...f, path }))
  const filtered = !!(filter.query || filter.path)
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
  // Lanes need every parent in the list: a message/author/file filter drops commits, so it gets plain dots (any branch's full log is fine).
  // Forward-only layout over the loaded pages: O(commits x lanes), and rows already shown never change when a page is appended.
  const graph = useMemo(() => {
    const rows = (filtered ? commits.map((x) => ({ col: 0, merge: x.parents.length > 1, into: [], out: [], pass: [] })) : graphRows(commits).rows).map((r) => fitRow(r, MAX_LANES))
    const lanes = rows.reduce((n, r) => Math.max(n, r.col + 1, ...r.into.map((i) => i + 1), ...r.out.map((i) => i + 1), ...r.pass.map((i) => i + 1)), 1)
    return { bySha: new Map(commits.map((x, i) => [x.sha, rows[i]!])), width: laneX(lanes - 1) + 15 }
  }, [commits, filtered])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = commits.find((x) => x.sha === picked) ?? commits[0]
  const [rebasing, setRebasing] = useState(false)

  return (
    <>
      <aside className={a.side}>
        <div className={s.branchRow}>
          <select aria-label="History branch" className={s.branch} value={ref} onChange={(e) => setRef(e.target.value)}>
            <option value="">Current branch{branches.data?.current ? ` (${branches.data.current})` : ''}</option>
            {branches.data?.local.filter((b) => b.name !== branches.data?.current).map((b) => <option key={b.name}>{b.name}</option>)}
            {branches.data?.remote.map((b) => <option key={b}>{b}</option>)}
          </select>
          {/* Current branch, unfiltered, HEAD unpushed: there is something to edit. */}
          {!ref && !filtered && commits[0]?.unpushed && (
            // Icon-only so the branch name keeps its width; the span carries the native tooltip (RAC Button takes no title).
            <span title="Edit unpushed commits…" className={s.editUnpushed}>
              <Button className="ghost" aria-label="Edit unpushed commits…" onPress={() => setRebasing(true)}>
                <ListTodo size={14} aria-hidden />
              </Button>
            </span>
          )}
        </div>
        <div className={s.filters}>
          <SearchField
            aria-label="Search messages"
            className={s.grep}
            isInvalid={queryErrors.length > 0}
            validationBehavior="aria"
            onChange={() => queryErrors.length && setQueryErrors([])}
            onSubmit={search}
            onClear={() => search('')}
          >
            <Input placeholder="Search, change:, author:, path:…" spellCheck={false} />
          </SearchField>
          <SearchHelp />
          {queryErrors.length > 0 && (
            <p role="alert" className={s.queryError}>
              {queryErrors.join(' · ')}
            </p>
          )}
          {filter.path && (
            <p className={s.fileFilter}>
              <span>
                History of <code>{filter.path}</code>
              </span>
              <Button onPress={() => setPath()}>All files</Button>
            </p>
          )}
        </div>
        {rebasing && <RebaseDialog repo={p.repo} onClose={() => setRebasing(false)} />}
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 44 }}>
          <GridList
            aria-label="Commits"
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            selectedKeys={selected ? [selected.sha] : []}
            onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
            className={c.list}
            style={{ ['--graph-w' as string]: `${graph.width}px` }}
            renderEmptyState={() => (q.data ? <p className={c.empty}>{filtered ? 'No matching commits' : 'No commits yet'}</p> : null)}
          >
            <Collection items={commits} dependencies={[p.decorate, graph]}>
              {(x) => (
                <GridListItem id={x.sha} textValue={x.summary} className={`${s.row} ${s.graphRow}`}>
                  {({ isSelected }) => (
                    <>
                      {isSelected && <Highlight id="sel-commits" />}
                      {graph.bySha.get(x.sha) && <GraphCell row={graph.bySha.get(x.sha)!} />}
                      <span className={s.summary}>{x.summary}</span>
                      <small className={s.meta}>
                        {x.author} · {ago(x.date)} · <code>{x.short}</code>
                        {x.unpushed && <span className={s.badge}>↑ unpushed</span>}
                        {p.decorate?.(x)}
                      </small>
                    </>
                  )}
                </GridListItem>
              )}
            </Collection>
            <GridListLoadMoreItem onLoadMore={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()} isLoading={q.isFetchingNextPage} />
          </GridList>
        </Virtualizer>
      </aside>
      <section className={a.main}>
        <PaneBanners />
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
              onFileHistory={setPath}
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
  // A second apply/pop over unmerged files would conflict again: resolve first (conflict banner).
  const unmerged = useQuery({ queryKey: ['status', p.repo], queryFn: () => window.mendel['changes:status']({ repo: p.repo }) }).data?.some((f) => f.conflicted) ?? false
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
              {({ isSelected }) => (
                <>
                  {isSelected && <Highlight id="sel-stashes" />}
                  <span className={s.summary}>{x.message}</span>
                  <small className={s.meta}>{ago(x.date)}</small>
                </>
              )}
            </GridListItem>
          )}
        </GridList>
      </aside>
      <section className={a.main}>
        <PaneBanners />
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {q.error ? (
          <p role="alert" className={c.empty}>
            {q.error.message}
          </p>
        ) : (
          selected && (
            <>
              <div className={c.fileHeader}>
                <Button isDisabled={unmerged} onPress={() => act('apply')}>Apply</Button>
                <Button isDisabled={unmerged} onPress={() => act('pop')}>Pop</Button>
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
  const [query, setQuery] = useState('')
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
  const { text, trailers } = splitTrailers(body.join('\n'))
  const shown = query.trim() ? d.files.filter(matchFile(query)) : d.files
  // The picked file stays selected while the filter still shows it.
  const f = shown.find((x) => x.path === file) ?? shown[0]
  const date = (ms: number) => new Date(ms).toLocaleString()
  const name = (who: string) => who.replace(/\s*<[^>]*>$/, '')
  return (
    <div className={s.detail} aria-label="Commit detail">
      <h2 className={s.title}>{summary}</h2>
      {/* concept .who: one muted line; full SHA, emails and absolute dates live in the tooltips */}
      <p className={s.who}>
        <span title={`Author: ${d.author}, ${date(d.authorDate)}${d.committer !== d.author ? `\nCommitter: ${d.committer}, ${date(d.committerDate)}` : ''}`}>
          {name(d.author)} committed {ago(d.authorDate)}
        </span>
        {' · '}
        <Button
          className={s.sha}
          aria-label={`${copied ? 'Copied' : 'Copy'} SHA ${d.sha}`}
          onPress={() => void window.mendel['app:copy']({ text: d.sha }).then(() => setCopied(true))}
        >
          <code title={`${d.sha}\n${date(d.committerDate)}\nClick to copy`}>{d.sha.slice(0, 7)}</code>
          {copied && <span aria-hidden> copied</span>}
        </Button>
        {d.parents.length > 0 && (
          <>
            {' · '}
            {d.parents.length > 1 ? 'parents' : 'parent'} <code title={d.parents.join('\n')}>{d.parents.map((x) => x.slice(0, 7)).join(' ')}</code>
          </>
        )}
      </p>
      <CommitTags repo={p.repo} sha={d.sha} />
      <div className={s.actions}>
        {/* Merge commits need a mainline (-m): not offered. */}
        {p.pick && d.parents.length < 2 && (
          <Button isDisabled={busy} onPress={pick}>
            {p.pick === 'revert' ? 'Revert commit' : 'Cherry-pick onto current branch'}
          </Button>
        )}
        {p.onAmend && <Button onPress={p.onAmend}>Amend last commit</Button>}
        <TagButton repo={p.repo} sha={d.sha} />
      </div>
      {error && <p role="alert" className={c.empty}>{error}</p>}
      {text && <pre className={s.message}>{text}</pre>}
      {trailers.length > 0 && <Trailers repo={p.repo} trailers={trailers} />}
      <FileFilter value={query} onChange={setQuery} count={shown !== d.files ? `${shown.length} of ${d.files.length} files` : undefined} className={s.filesFilter} />
      <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 30 }}>
        <ListBox
          aria-label="Changed files"
          items={shown}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={f ? [f.path] : []}
          onSelectionChange={(keys) => keys !== 'all' && keys.size && setFile(String([...keys][0]))}
          className={s.files}
          renderEmptyState={() => <p className={c.empty}>No matching files</p>}
        >
          {(x) => (
            // Row-fill selection, not the floating plate: rows sit inside a bordered table. Hairline above every row but the first.
            <ListBoxItem id={x.path} textValue={x.path} className={x === shown[0] ? s.fileRow : `${s.fileRow} ${s.divided}`}>
              <span className={c.letter} data-status={x.status}>
                {x.status}
              </span>
              <span className={s.filePath}>{x.origPath ? `${x.origPath} → ${x.path}` : x.path}</span>
              {x.add !== undefined && (
                <span className={s.fileStat}>
                  <span className={c.statAdd}>+{x.add}</span> <span className={c.statDel}>−{x.del}</span>
                </span>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Virtualizer>
      {f && (
        <div className={c.fileHeader}>
          <h2>{f.origPath ? `${f.origPath} → ${f.path}` : f.path}</h2>
          {p.onFileHistory && <Button className="ghost" onPress={() => p.onFileHistory?.(f.path)}>File history</Button>}
          {/* A deleted file has nothing to blame at this commit. */}
          {f.status !== 'D' && <Button className="ghost" onPress={() => setBlame(!blame)}>{blame ? 'Show diff' : 'Blame'}</Button>}
        </div>
      )}
      {f && (blame && f.status !== 'D' ? <BlameView key={f.path} repo={p.repo} sha={d.sha} path={f.path} onPick={p.onPick} /> : <CommitFileDiff repo={p.repo} sha={d.sha} file={f} />)}
    </div>
  )
}

/** Tags on this commit as chips (Push / Delete). */
function CommitTags(p: { repo: string; sha: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['tags', p.repo], queryFn: () => window.mendel['tag:list']({ repo: p.repo }) })
  const [error, setError] = useState<string | null>(null)
  const run = (op: Promise<unknown>) => {
    setError(null)
    void op.then(
      () => refreshRepo(qc, p.repo),
      (err: Error) => setError(err.message)
    )
  }
  const tags = q.data?.filter((t) => t.sha === p.sha) ?? []
  if (!tags.length && !error) return null
  return (
    <div className={s.tags}>
      {tags.map((t) => (
        <span key={t.name} aria-label={`Tag ${t.name}`} className={s.tag}>
          <code>{t.name}</code>
          <Button className="ghost" onPress={() => run(window.mendel['tag:push']({ repo: p.repo, name: t.name }))}>Push</Button>
          <Button className="ghost" onPress={() => run(window.mendel['tag:delete']({ repo: p.repo, name: t.name }))}>Delete…</Button>
        </span>
      ))}
      {error && (
        <p role="alert" className={a.error}>
          {error}
        </p>
      )}
    </div>
  )
}

/** "?" next to the History search: the qualifiers it understands. */
function SearchHelp() {
  const [open, setOpen] = useState(false)
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className="ghost" aria-label="Search help">
        <CircleHelp size={14} aria-hidden />
      </Button>
      <AnimatePresence>
        {open && (
          <PopPopover placement="bottom end" className={r.popover}>
            <Dialog aria-label="Search help" className={r.menu}>
              <dl className={s.searchHelp}>
                {QUALIFIERS.map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      <code>{k}</code>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <small className={s.searchHelpNote}>Plain words search commit messages. Everything is ANDed; Enter applies.</small>
            </Dialog>
          </PopPopover>
        )}
      </AnimatePresence>
    </DialogTrigger>
  )
}

/** "Tag…" popover: name and optional message (a message makes the tag annotated). */
function TagButton(p: { repo: string; sha: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    void window.mendel['tag:create']({ repo: p.repo, name: name.trim(), sha: p.sha, message: message.trim() || undefined }).then(
      () => (setName(''), setMessage(''), setOpen(false), refreshRepo(qc, p.repo)),
      (err: Error) => setError(err.message)
    )
  }
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <Button>Tag…</Button>
      <AnimatePresence>
        {open && (
          <PopPopover placement="bottom start" className={r.popover}>
            <Dialog aria-label="Create tag" className={r.menu}>
              <form onSubmit={submit} className={s.tagForm}>
                <TextField value={name} onChange={setName} autoFocus className={a.field}>
                  <Label>Tag name</Label>
                  <Input spellCheck={false} />
                </TextField>
                <TextField value={message} onChange={setMessage} className={a.field}>
                  <Label>Message (optional, annotated)</Label>
                  <Input spellCheck={false} />
                </TextField>
                {error && (
                  <p role="alert" className={a.error}>
                    {error}
                  </p>
                )}
                <Button type="submit" isDisabled={!name.trim()}>
                  Create tag
                </Button>
              </form>
            </Dialog>
          </PopPopover>
        )}
      </AnimatePresence>
    </DialogTrigger>
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
