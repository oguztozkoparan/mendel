import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Collection, Header, Input, ListBox, ListBoxItem, ListBoxLoadMoreItem, ListBoxSection, ListLayout, SearchField, Virtualizer } from 'react-aria-components'
import { GERRIT_AUTH_ERROR, type GerritChange } from '../../../../shared/gerrit'
import { GERRIT_QUALIFIERS, parseGerritSearch, type GerritSearch } from '../../../../shared/gerritQuery'
import type { ProviderState, RepoEntry } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { useDebounced } from '../../debounce'
import { PaneBanners } from '../../ErrorBanner'
import { openSettings, useSettings } from '../../Settings'
import { Segmented } from '../../controls'
import { SearchHelp } from '../../History'
import h from '../../History.module.css'
import { ChangeDetail } from './ChangeDetail'
import c from '../../Changes.module.css'
import { GerritConnectDialog } from './GerritConnectDialog'
import s from './Gerrit.module.css'
import { RepoProviderDialog } from './RepoProviderDialog'
import { initial, labelSummary, needsMe, shortDate, who } from './util'
import { Highlight } from '../../motion'

/** Reviews tab (PLAN.md §3.7): Mine (Outgoing / Incoming / Recently closed) or History (searchable, paged) in the sidebar, change detail in the main pane. */
export function Reviews({ repo, state, focus }: { repo: RepoEntry; state: ProviderState; focus?: { change: number } | null }) {
  const [dialog, setDialog] = useState<'provider' | 'connect' | null>(null)
  const [projectOnly, setProjectOnly] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<'mine' | 'history'>('mine')
  // History search applies as you type (debounced: one Gerrit request per pause, not per key) and on Enter;
  // an invalid search keeps the last applied one and shows why.
  const [search, setSearch] = useState<GerritSearch>({})
  const [searchErrors, setSearchErrors] = useState<string[]>([])
  const applySearch = (v: string) => {
    const { query, errors } = parseGerritSearch(v)
    setSearchErrors(errors)
    if (!errors.length) setSearch(query)
  }
  const typed = useDebounced(applySearch, 400)
  useEffect(() => void (focus && setSelected(focus.change)), [focus])
  const d = state.detection!
  const ready = !!d.baseUrl && !!state.credentialUser
  // Same query as the conflict banner: while an op is stopped, its Continue is the one primary.
  const primary = useQuery({ queryKey: ['conflict', repo.id], queryFn: () => window.mendel['conflict:state']({ repo: repo.id }) }).data ? undefined : 'primary'
  const refreshMinutes = useSettings().data?.reviewsRefreshMinutes ?? 5
  const lists = useQuery({
    queryKey: ['gerrit', repo.id, 'changes', projectOnly],
    queryFn: () => window.mendel['gerrit:changes']({ repo: repo.id, projectOnly }),
    enabled: ready,
    refetchInterval: refreshMinutes * 60_000
  })
  const history = useInfiniteQuery({
    queryKey: ['gerrit', repo.id, 'search', projectOnly, search],
    queryFn: ({ pageParam }) => window.mendel['gerrit:search']({ repo: repo.id, projectOnly, query: search, start: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.more ? all.reduce((n, p) => n + p.changes.length, 0) : undefined),
    enabled: ready && tab === 'history',
    placeholderData: keepPreviousData
  })
  // A change can move between pages while paging (updated sorts it to the top): keep its first occurrence only.
  const historyChanges = useMemo(() => {
    const seen = new Set<number>()
    return (history.data?.pages.flatMap((p) => p.changes) ?? []).filter((ch) => !seen.has(ch._number) && !!seen.add(ch._number))
  }, [history.data])
  const listError = lists.error ?? (tab === 'history' ? history.error : null)
  // Keyed by credential user: reconnecting as someone else re-reads the account id.
  const self = useQuery({ queryKey: ['gerrit', repo.id, 'self', state.credentialUser], queryFn: () => window.mendel['gerrit:self']({ repo: repo.id }), enabled: ready, staleTime: Infinity })
  const me = self.data ?? null
  const authFailed = lists.error?.message === GERRIT_AUTH_ERROR || history.error?.message === GERRIT_AUTH_ERROR

  let main
  if (!d.baseUrl)
    main = (
      <div className={s.card} role="region" aria-label="Set Gerrit URL">
        <strong>Set Gerrit URL</strong>
        <p>{d.host} looks like Gerrit, but its web address could not be found.</p>
        <Button className={primary} onPress={() => setDialog('provider')}>
          Set Gerrit URL…
        </Button>
      </div>
    )
  else if (!state.credentialUser || authFailed)
    main = (
      <div className={s.card} role="region" aria-label="Connect to Gerrit">
        <strong>Connect to Gerrit</strong>
        <p>
          {authFailed
            ? 'Gerrit rejected the saved HTTP password / token; it may have expired.'
            : `Sign in to ${d.baseUrl} with your username and HTTP password to see reviews.`}
        </p>
        <Button className={primary} onPress={() => setDialog('connect')}>
          Connect…
        </Button>
      </div>
    )
  else if (listError)
    main = (
      <div className={s.card} role="alert">
        <p>{listError.message}</p>
        <Button onPress={() => void (lists.error ? lists.refetch() : history.refetch())}>Retry</Button>
      </div>
    )
  else main = selected ? <ChangeDetail key={selected} repo={repo.id} number={selected} me={me} onBack={() => setSelected(null)} onOpen={setSelected} /> : <p className={s.empty}>Select a change</p>

  const sections: [string, GerritChange[]][] = lists.data
    ? [
        ['Outgoing', lists.data.outgoing],
        ['Incoming', lists.data.incoming],
        ['Recently closed', lists.data.closed]
      ]
    : []

  return (
    <>
      <aside className={a.side}>
        <div className={s.sideHeader}>
          <span className={s.grow}>{d.project || d.host}</span>
          {d.baseUrl && (
            <Button className="ghost" onPress={() => openSettings('Git providers')}>
              Account…
            </Button>
          )}
          <Button className="ghost" onPress={() => openSettings('Git providers')}>
            Gerrit settings…
          </Button>
        </div>
        {ready && (
          <div className={s.subTabs}>
            <Segmented<'mine' | 'history'>
              label="Reviews view"
              value={tab}
              options={[
                ['mine', 'Mine'],
                ['history', 'History']
              ]}
              onChange={setTab}
            />
          </div>
        )}
        {ready && (
          <div className={s.sideHeader}>
            <Checkbox isSelected={projectOnly} onChange={setProjectOnly} className={c.amend}>
              <span className={c.box} aria-hidden>
                {projectOnly ? '✓' : ''}
              </span>
              This project only
            </Checkbox>
            <span className={s.grow} />
            <Button className="ghost" aria-label="Refresh reviews" onPress={() => void (tab === 'mine' ? lists.refetch() : history.refetch())}>
              <RefreshCw size={14} aria-hidden />
            </Button>
          </div>
        )}
        {tab === 'mine' && lists.data && sections.every(([, l]) => !l.length) && (
          <p className={s.empty}>
            No open changes. Commit, then use Send for review to create one.
          </p>
        )}
        {tab === 'mine' && lists.data && (
          <ListBox
            aria-label="Reviews"
            selectionMode="single"
            selectedKeys={selected ? [selected] : []}
            onSelectionChange={(k) => k !== 'all' && k.size && setSelected(Number([...k][0]))}
            className={c.list}
          >
            {sections.map(([title, list]) => (
              <ListBoxSection key={title} id={title} aria-label={title}>
                <Header className={s.sectionHeader}>
                  {title} ({list.length})
                </Header>
                {list.map((ch) => (
                  <ListBoxItem key={`${title}-${ch._number}`} id={ch._number} textValue={`${ch.subject} #${ch._number}`} className={s.changeRow}>
                    {({ isSelected }) => <ChangeRow ch={ch} me={me} hl={isSelected ? 'sel-changes' : null} />}
                  </ListBoxItem>
                ))}
              </ListBoxSection>
            ))}
          </ListBox>
        )}
        {ready && tab === 'history' && (
          <>
            <div className={h.filters}>
              <SearchField
                aria-label="Search reviews"
                className={h.grep}
                isInvalid={searchErrors.length > 0}
                validationBehavior="aria"
                // the native × (and select-all + delete) only reports an empty value, never onClear
                onChange={(v) => (v === '' ? typed.now('') : typed.run(v))}
                onSubmit={typed.now}
                onClear={() => typed.now('')}
              >
                <Input placeholder="Search, owner:, status:, label:…" spellCheck={false} />
              </SearchField>
              <SearchHelp rows={GERRIT_QUALIFIERS} note="Plain words search commit messages. Everything is ANDed; applies as you type." />
              {searchErrors.length > 0 && (
                <p role="alert" className={h.queryError}>
                  {searchErrors.join(' · ')}
                </p>
              )}
            </div>
            <Virtualizer layout={ListLayout} layoutOptions={{ estimatedRowHeight: 46 }}>
              <ListBox
                aria-label="Review history"
                selectionMode="single"
                selectedKeys={selected ? [selected] : []}
                onSelectionChange={(k) => k !== 'all' && k.size && setSelected(Number([...k][0]))}
                className={c.list}
                renderEmptyState={() => (history.data ? <p className={s.empty}>No matching changes</p> : null)}
              >
                <Collection items={historyChanges} dependencies={[me]}>
                  {(ch) => (
                    <ListBoxItem id={ch._number} textValue={`${ch.subject} #${ch._number}`} className={s.changeRow}>
                      {({ isSelected }) => <ChangeRow ch={ch} me={me} hl={isSelected ? 'sel-review-history' : null} />}
                    </ListBoxItem>
                  )}
                </Collection>
                <ListBoxLoadMoreItem onLoadMore={() => history.hasNextPage && !history.isFetchingNextPage && void history.fetchNextPage()} isLoading={history.isFetchingNextPage} />
              </ListBox>
            </Virtualizer>
          </>
        )}
      </aside>
      <section className={a.main}>
        <PaneBanners />
        {main}
      </section>
      <AnimatePresence>
        {dialog === 'provider' && <RepoProviderDialog key="provider" repo={repo.id} state={state} onClose={() => setDialog(null)} />}
        {dialog === 'connect' && <GerritConnectDialog key="connect" repo={repo.id} state={state} expired={authFailed} onClose={() => setDialog(null)} />}
      </AnimatePresence>
    </>
  )
}

/** One review row: owner initial, subject, #number · status · labels · updated (Mine and History lists). */
function ChangeRow({ ch, me, hl }: { ch: GerritChange; me: number | null; hl: string | null }) {
  return (
    <>
      {hl && <Highlight id={hl} />}
      <span className={s.avatar} title={who(ch.owner)} aria-hidden>
        {initial(ch.owner)}
      </span>
      <span className={s.changeText}>
        <span className={s.subject}>{ch.subject}</span>
        <span className={s.meta}>
          {needsMe(ch, me) && <span className={s.attention}>Your turn · </span>}#{ch._number} · {ch.status === 'NEW' ? 'Open' : ch.status.charAt(0) + ch.status.slice(1).toLowerCase()}
          {ch.work_in_progress && ' · WIP'}
          {!!ch.unresolved_comment_count && ` · ${ch.unresolved_comment_count} unresolved`}
          {labelSummary(ch.labels).map((l) => ` · ${l}`)} · {shortDate(ch.updated)}
        </span>
      </span>
    </>
  )
}
