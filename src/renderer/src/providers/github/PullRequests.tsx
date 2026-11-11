import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { ProviderState } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { PaneBanners } from '../../ErrorBanner'
import s from './GitHub.module.css'
import { SignInDialog } from './SignInDialog'

/** Pull requests tab of a github.com repo. For now only the sign-in state (per host, not per repo). */
export function PullRequests({ state }: { state: ProviderState }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  /** false right after a sign-in without a usable OS keychain. */
  const [persisted, setPersisted] = useState(true)
  const account = useQuery({ queryKey: ['githubAccount'], queryFn: () => window.mendel['github:account']() })
  const refresh = () => qc.invalidateQueries({ queryKey: ['githubAccount'] })
  const login = account.data
  const project = state.detection?.project

  return (
    <>
      <aside className={a.side} />
      <section className={a.main}>
        <PaneBanners />
        {account.isSuccess &&
          (login ? (
            <div className={`${a.card} ${s.signin}`} role="region" aria-label="GitHub account">
              <p className={s.login} title={`Signed in as ${login}`}>
                <strong>Signed in as {login}</strong>
              </p>
              {!persisted && <p>No OS keychain available: you stay signed in for this session only.</p>}
              <Button onPress={() => void window.mendel['github:signOut']().then(refresh)}>Sign out</Button>
            </div>
          ) : (
            <div className={`${a.card} ${s.signin}`} role="region" aria-label="Sign in to GitHub">
              <strong>Sign in to GitHub</strong>
              <p>Sign in with your GitHub account to see pull requests{project ? ` for ${project}` : ''}.</p>
              <Button className="primary" onPress={() => setDialog(true)}>
                Sign in…
              </Button>
            </div>
          ))}
      </section>
      <AnimatePresence>
        {dialog && (
          <SignInDialog
            key="signin"
            onDone={(r) => (setPersisted(r.persisted), setDialog(false), void refresh())}
            onClose={() => setDialog(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
