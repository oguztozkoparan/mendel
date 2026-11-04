import { useState } from 'react'
import { Tab, TabList, TabPanel, Tabs, type Key } from 'react-aria-components'
import type { RepoEntry } from '../../shared/ipc'
import s from './App.module.css'
import { ChangesView } from './Changes'
import { HistoryView } from './History'
import { useMenuCommand } from './menu'

/** Open repo: tabs in the sidebar head; each panel lays out its own sidebar list + main pane (PLAN.md §3). */
export function RepoView({ repo }: { repo: RepoEntry }) {
  const [tab, setTab] = useState<Key>('changes')
  // Mod+3 (`tab:provider`) is left to the provider tab once one exists.
  useMenuCommand((c) => (c === 'tab:changes' || c === 'tab:history') && setTab(c.slice(4)))
  return (
    <Tabs className={s.repoView} selectedKey={tab} onSelectionChange={setTab}>
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
