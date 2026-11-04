import { useQuery } from '@tanstack/react-query'
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import type { RepoEntry } from '../../shared/ipc'
import s from './App.module.css'
import { ChangesView } from './Changes'
import { Reviews } from './providers/gerrit/Reviews'

/** Open repo: tabs in the sidebar head; each panel lays out its own sidebar list + main pane (PLAN.md §3). */
export function RepoView({ repo }: { repo: RepoEntry }) {
  const provider = useQuery({ queryKey: ['provider', repo.id], queryFn: () => window.gitdock['provider:get']({ repo: repo.id }) })
  const gerrit = provider.data?.detection?.provider === 'gerrit' ? provider.data : null
  return (
    <Tabs className={s.repoView}>
      <TabList aria-label="Views" className={s.tabs}>
        <Tab id="changes">Changes</Tab>
        <Tab id="history">History</Tab>
        {gerrit && <Tab id="reviews">Reviews</Tab>}
      </TabList>
      <TabPanel id="changes" className={s.panel}>
        <ChangesView repo={repo} />
      </TabPanel>
      <TabPanel id="history" className={s.panel}>
        <aside className={s.side} />
        <section className={s.main} />
      </TabPanel>
      {gerrit && (
        <TabPanel id="reviews" className={s.panel}>
          <Reviews repo={repo} state={gerrit} />
        </TabPanel>
      )}
    </Tabs>
  )
}
