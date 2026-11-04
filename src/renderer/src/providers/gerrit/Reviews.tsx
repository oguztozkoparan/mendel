import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { ProviderState, RepoEntry } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { GerritConnectDialog } from './GerritConnectDialog'
import s from './Gerrit.module.css'
import { RepoProviderDialog } from './RepoProviderDialog'

/** Reviews tab (PLAN.md §3.7): status cards until Gerrit is reachable and connected. */
export function Reviews({ repo, state }: { repo: RepoEntry; state: ProviderState }) {
  const [dialog, setDialog] = useState<'provider' | 'connect' | null>(null)
  const d = state.detection!
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
  else if (!state.credentialUser)
    main = (
      <div className={s.card} role="region" aria-label="Connect to Gerrit">
        <strong>Connect to Gerrit</strong>
        <p>Sign in to {d.baseUrl} with your username and HTTP password to see reviews.</p>
        <Button className="primary" onPress={() => setDialog('connect')}>
          Connect…
        </Button>
      </div>
    )
  else
    main = (
      <p className={s.empty}>
        Gerrit {d.serverVersion} at {d.baseUrl}
      </p>
    )

  return (
    <>
      <aside className={a.side}>
        <div className={s.sideHeader}>
          <span className={s.grow}>{d.project || d.host}</span>
          {d.baseUrl && <Button onPress={() => setDialog('connect')}>Account…</Button>}
          <Button onPress={() => setDialog('provider')}>Gerrit settings…</Button>
        </div>
      </aside>
      <section className={a.main}>{main}</section>
      {dialog === 'provider' && <RepoProviderDialog repo={repo.id} state={state} onClose={() => setDialog(null)} />}
      {dialog === 'connect' && <GerritConnectDialog repo={repo.id} state={state} onClose={() => setDialog(null)} />}
    </>
  )
}
