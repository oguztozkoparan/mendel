import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button, Checkbox, Header, ListBox, ListBoxItem, ListBoxSection } from 'react-aria-components'
import { GERRIT_AUTH_ERROR, type GerritChange } from '../../../../shared/gerrit'
import type { ProviderState, RepoEntry } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { useSettings } from '../../Settings'
import { ChangeDetail } from './ChangeDetail'
import c from '../../Changes.module.css'
import { GerritConnectDialog } from './GerritConnectDialog'
import s from './Gerrit.module.css'
import { RepoProviderDialog } from './RepoProviderDialog'
import { initial, labelSummary, needsMe, shortDate, who } from './util'

/** Reviews tab (PLAN.md §3.7): Outgoing / Incoming / Recently closed in the sidebar, change detail in the main pane. */
export function Reviews({ repo, state, focus }: { repo: RepoEntry; state: ProviderState; focus?: { change: number } | null }) {
  const [dialog, setDialog] = useState<'provider' | 'connect' | null>(null)
  const [projectOnly, setProjectOnly] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => void (focus && setSelected(focus.change)), [focus])
  const d = state.detection!
  const ready = !!d.baseUrl && !!state.credentialUser
  const refreshMinutes = useSettings().data?.reviewsRefreshMinutes ?? 5
  const lists = useQuery({
    queryKey: ['gerrit', repo.id, 'changes', projectOnly],
    queryFn: () => window.mendel['gerrit:changes']({ repo: repo.id, projectOnly }),
    enabled: ready,
    refetchInterval: refreshMinutes * 60_000
  })
  const authFailed = lists.error?.message === GERRIT_AUTH_ERROR

  let main
  if (!d.baseUrl)
    main = (
      <div className={s.card} role="region" aria-label="Set Gerrit URL">
        <strong>Set Gerrit URL</strong>
        <p>{d.host} looks like Gerrit, but its web address could not be found.</p>
        <Button className="primary" onPress={() => setDialog('provider')}>
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
        <Button className="primary" onPress={() => setDialog('connect')}>
          Connect…
        </Button>
      </div>
    )
  else if (lists.error)
    main = (
      <div className={s.card} role="alert">
        <p>{lists.error.message}</p>
        <Button onPress={() => void lists.refetch()}>Retry</Button>
      </div>
    )
  else main = selected ? <ChangeDetail key={selected} repo={repo.id} number={selected} me={state.credentialUser} onBack={() => setSelected(null)} /> : <p className={s.empty}>Select a change</p>

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
          {d.baseUrl && <Button onPress={() => setDialog('connect')}>Account…</Button>}
          <Button onPress={() => setDialog('provider')}>Gerrit settings…</Button>
        </div>
        {ready && (
          <div className={s.sideHeader}>
            <Checkbox isSelected={projectOnly} onChange={setProjectOnly} className={c.amend}>
              <span className={c.box} aria-hidden>
                {projectOnly ? '✓' : ''}
              </span>
              This project only
            </Checkbox>
            <span className={s.grow} />
            <Button aria-label="Refresh reviews" onPress={() => void lists.refetch()}>
              ⟳
            </Button>
          </div>
        )}
        {lists.data && sections.every(([, l]) => !l.length) && (
          <p className={s.empty}>
            No open changes. Commit, then use Send for review to create one.
          </p>
        )}
        {lists.data && (
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
                    <span className={s.avatar} title={who(ch.owner)} aria-hidden>
                      {initial(ch.owner)}
                    </span>
                    <span className={s.changeText}>
                      <span className={s.subject}>{ch.subject}</span>
                      <span className={s.meta}>
                        {needsMe(ch, state.credentialUser) && <span className={s.attention}>Your turn · </span>}#{ch._number} · {ch.status === 'NEW' ? 'Open' : ch.status.charAt(0) + ch.status.slice(1).toLowerCase()}
                        {ch.work_in_progress && ' · WIP'}
                        {!!ch.unresolved_comment_count && ` · ${ch.unresolved_comment_count} unresolved`}
                        {labelSummary(ch.labels).map((l) => ` · ${l}`)} · {shortDate(ch.updated)}
                      </span>
                    </span>
                  </ListBoxItem>
                ))}
              </ListBoxSection>
            ))}
          </ListBox>
        )}
      </aside>
      <section className={a.main}>{main}</section>
      {dialog === 'provider' && <RepoProviderDialog repo={repo.id} state={state} onClose={() => setDialog(null)} />}
      {dialog === 'connect' && <GerritConnectDialog repo={repo.id} state={state} expired={authFailed} onClose={() => setDialog(null)} />}
    </>
  )
}
