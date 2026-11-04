import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import type { RepoEntry } from '../../shared/ipc'
import s from './App.module.css'
import { ChangesView } from './Changes'
import { HistoryView } from './History'

/** Open repo: tabs in the sidebar head; each panel lays out its own sidebar list + main pane (PLAN.md §3). */
export function RepoView({ repo }: { repo: RepoEntry }) {
  return (
    <Tabs className={s.repoView}>
      <TabList aria-label="Views" className={s.tabs}>
        <Tab id="changes">Changes</Tab>
        <Tab id="history">History</Tab>
      </TabList>
      <TabPanel id="changes" className={s.panel}>
        <ChangesView repo={repo} />
      </TabPanel>
      <TabPanel id="history" className={s.panel}>
        <HistoryView repo={repo.id} />
      </TabPanel>
    </Tabs>
  )
}
