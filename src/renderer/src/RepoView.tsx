import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Tab, TabList, TabPanel, Tabs, type Key } from 'react-aria-components'
import type { CommitSummary, RepoEntry } from '../../shared/ipc'
import s from './App.module.css'
import { useBranches } from './Branches'
import { ChangesView } from './Changes'
import { HistoryView } from './History'
import h from './History.module.css'
import { useMenuCommand } from './menu'
import { Reviews } from './providers/gerrit/Reviews'
/** Open repo: tabs in sidebar head; panel lays out its own sidebar list + main pane (PLAN.md §3). */
export function RepoView({ repo, focus }: { repo: RepoEntry; focus?: { change: number } | null }) {
  const [tab, setTab] = useState<Key>('changes')
  /** History "Amend": Changes opens with "Amend last commit" ticked. */
  const [amend, setAmend] = useState(false)
  useEffect(() => void (focus && setTab('reviews')), [focus])
  const provider = useQuery({ queryKey: ['provider', repo.id], queryFn: () => window.gitdock['provider:get']({ repo: repo.id }) })
  const gerrit = provider.data?.detection?.provider === 'gerrit' ? provider.data : null
  const head = useBranches(repo.id).data?.head
  const badges = useQuery({ queryKey: ['gerritBadges', repo.id, head], queryFn: () => window.gitdock['gerrit:badges']({ repo: repo.id }), enabled: !!gerrit })
  // Stable per badge data: History's Collection re-renders every row when `decorate` changes.
  const isGerrit = !!gerrit
  const decorate = useMemo(
    () => (isGerrit ? (c: CommitSummary) => badges.data?.[c.sha] && <span className={h.badge}>in review #{badges.data[c.sha]}</span> : undefined),
    [isGerrit, badges.data]
  )
  useMenuCommand((c) => {
    if (c === 'tab:changes' || c === 'tab:history') setTab(c.slice(4))
    else if (c === 'tab:provider' && gerrit) setTab('reviews')
  })
  return (
    <Tabs className={s.repoView} selectedKey={tab} onSelectionChange={setTab}>
      <TabList aria-label="Views" className={s.tabs}>
        <Tab id="changes">Changes</Tab>
        <Tab id="history">History</Tab>
        {gerrit && <Tab id="reviews">Reviews</Tab>}
      </TabList>
      <TabPanel id="changes" className={s.panel}>
        <ChangesView repo={repo} amend={amend} onAmendDone={() => setAmend(false)} />
      </TabPanel>
      <TabPanel id="history" className={s.panel}>
        <HistoryView repo={repo.id} decorate={decorate} onAmend={() => (setAmend(true), setTab('changes'))} />
      </TabPanel>
      {gerrit && (
        <TabPanel id="reviews" className={s.panel}>
          <Reviews repo={repo} state={gerrit} focus={focus} />
        </TabPanel>
      )}
    </Tabs>
  )
}
