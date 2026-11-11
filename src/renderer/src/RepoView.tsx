import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Tab, TabList, TabPanel, Tabs, type Key } from 'react-aria-components'
import type { CommitSummary, RepoEntry } from '../../shared/ipc'
import s from './App.module.css'
import { useBranches } from './Branches'
import { ChangesView } from './Changes'
import { HistoryView, StashesView } from './History'
import h from './History.module.css'
import { useMenuCommand } from './menu'
import { Highlight } from './motion'
import { Reviews } from './providers/gerrit/Reviews'
import { PullRequests } from './providers/github/PullRequests'
import type { Notice } from './SyncButton'
/** Tab label with the sliding underline under the selected one. */
const tabLabel = (label: string) => ({ isSelected }: { isSelected: boolean }) => (
  <>
    {isSelected && <Highlight id="repo-tab" />}
    {label}
  </>
)

/** Open repo: tabs in sidebar head; panel lays out its own sidebar list + main pane (PLAN.md §3). */
export function RepoView({ repo, focus, onNotice }: { repo: RepoEntry; focus?: { change: number } | null; onNotice(n: Notice): void }) {
  const [tab, setTab] = useState<Key>('changes')
  /** History "Amend": Changes opens with "Amend last commit" ticked. */
  const [amend, setAmend] = useState(false)
  /** Repository → Discard All Changes…: Changes opens with the confirm shown. */
  const [discard, setDiscard] = useState(false)
  useEffect(() => void (focus && setTab('reviews')), [focus])
  const provider = useQuery({ queryKey: ['provider', repo.id], queryFn: () => window.mendel['provider:get']({ repo: repo.id }) })
  const gerrit = provider.data?.detection?.provider === 'gerrit' ? provider.data : null
  const github = provider.data?.detection?.provider === 'github' ? provider.data : null
  const head = useBranches(repo.id).data?.head
  const badges = useQuery({ queryKey: ['gerritBadges', repo.id, head], queryFn: () => window.mendel['gerrit:badges']({ repo: repo.id }), enabled: !!gerrit })
  // Stable per badge data: History's Collection re-renders every row when `decorate` changes.
  const isGerrit = !!gerrit
  const decorate = useMemo(
    () => (isGerrit ? (c: CommitSummary) => badges.data?.[c.sha] && <span className={h.badge}>in review #{badges.data[c.sha]}</span> : undefined),
    [isGerrit, badges.data]
  )
  useMenuCommand((c) => {
    if (c === 'tab:changes' || c === 'tab:history') setTab(c.slice(4))
    else if (c === 'tab:provider' && gerrit) setTab('reviews')
    else if (c === 'tab:provider' && github) setTab('pulls')
    else if (c === 'changes:discardAll') (setTab('changes'), setDiscard(true))
  })
  return (
    // A provider tab disappears when the provider is removed: an unknown selectedKey leaves no tab or panel shown.
    <Tabs className={s.repoView} selectedKey={(tab === 'reviews' && !gerrit) || (tab === 'pulls' && !github) ? 'changes' : tab} onSelectionChange={setTab}>
      <TabList aria-label="Views" className={s.tabs}>
        <Tab id="changes">{tabLabel('Changes')}</Tab>
        <Tab id="history">{tabLabel('History')}</Tab>
        <Tab id="stashes">{tabLabel('Stashes')}</Tab>
        {gerrit && <Tab id="reviews">{tabLabel('Reviews')}</Tab>}
        {github && <Tab id="pulls" className={s.tabFit}>{tabLabel('Pull requests')}</Tab>}
      </TabList>
      <TabPanel id="changes" className={s.panel}>
        <ChangesView repo={repo} amend={amend} onAmendDone={() => setAmend(false)} discard={discard} onDiscardAsked={() => setDiscard(false)} onNotice={onNotice} />
      </TabPanel>
      <TabPanel id="history" className={s.panel}>
        <HistoryView repo={repo.id} decorate={decorate} onAmend={() => (setAmend(true), setTab('changes'))} />
      </TabPanel>
      <TabPanel id="stashes" className={s.panel}>
        <StashesView repo={repo.id} />
      </TabPanel>
      {gerrit && (
        <TabPanel id="reviews" className={s.panel}>
          <Reviews repo={repo} state={gerrit} focus={focus} />
        </TabPanel>
      )}
      {github && (
        <TabPanel id="pulls" className={s.panel}>
          <PullRequests state={github} />
        </TabPanel>
      )}
    </Tabs>
  )
}
