import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { ProviderState, RepoEntry } from '../../../../shared/ipc'
import a from '../../App.module.css'
import s from './Gerrit.module.css'
import { RepoProviderDialog } from './RepoProviderDialog'

/** Reviews tab (PLAN.md §3.7): status cards until Gerrit is reachable. */
export function Reviews({ repo, state }: { repo: RepoEntry; state: ProviderState }) {
  const [dialog, setDialog] = useState(false)
  const d = state.detection!
  return (
    <>
      <aside className={a.side}>
        <div className={s.sideHeader}>
          <span className={s.grow}>{d.project || d.host}</span>
          <Button onPress={() => setDialog(true)}>Gerrit settings…</Button>
        </div>
      </aside>
      <section className={a.main}>
        {!d.baseUrl ? (
          <div className={s.card} role="region" aria-label="Set Gerrit URL">
            <strong>Set Gerrit URL</strong>
            <p>{d.host} looks like Gerrit, but its web address could not be found.</p>
            <Button className="primary" onPress={() => setDialog(true)}>
              Set Gerrit URL…
            </Button>
          </div>
        ) : (
          <p className={s.empty}>
            Gerrit {d.serverVersion} at {d.baseUrl}
          </p>
        )}
      </section>
      {dialog && <RepoProviderDialog repo={repo.id} state={state} onClose={() => setDialog(false)} />}
    </>
  )
}
