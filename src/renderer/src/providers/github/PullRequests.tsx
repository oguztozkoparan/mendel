import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { Button, ListBox, ListBoxItem } from 'react-aria-components'
import { GITHUB_AUTH_ERROR, GITHUB_NOT_VISIBLE, type GithubPull } from '../../../../shared/github'
import type { ProviderState } from '../../../../shared/ipc'
import a from '../../App.module.css'
import c from '../../Changes.module.css'
import { PaneBanners } from '../../ErrorBanner'
import { Highlight } from '../../motion'
import { useSettings } from '../../Settings'
import { ago } from '../../time'
import pc from '../Provider.module.css'
import s from './GitHub.module.css'
import { SignInDialog } from './SignInDialog'

/** Pull requests tab of a github.com repo: open pull requests in the sidebar, the selected one's detail in the main pane. */
export function PullRequests({ repo, state }: { repo: string; state: ProviderState }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  /** false right after a sign-in without a usable OS keychain. */
  const [persisted, setPersisted] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const account = useQuery({ queryKey: ['githubAccount'], queryFn: () => window.mendel['github:account']() })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['githubAccount'] }), qc.invalidateQueries({ queryKey: ['github', repo] })])
  const login = account.data
  const project = state.detection?.project ?? ''
  const refreshMinutes = useSettings().data?.reviewsRefreshMinutes ?? 5
  const pulls = useQuery({
    queryKey: ['github', repo, 'pulls', login],
    queryFn: () => window.mendel['github:pulls']({ repo }),
    enabled: !!login,
    refetchInterval: refreshMinutes * 60_000
  })
  const authFailed = pulls.error?.message === GITHUB_AUTH_ERROR
  const signedIn = !!login && !authFailed
  // Derived, so a pull request that is gone after a refetch deselects itself.
  const pr = pulls.data?.pulls.find((p) => p.number === selected)
  // A failed refetch keeps react-query's old data: do not list it next to the error.
  const list = signedIn && !pulls.error ? pulls.data : undefined

  let main
  if (!account.isSuccess) main = null
  else if (!signedIn)
    main = (
      <div className={`${a.card} ${s.signin}`} role="region" aria-label="Sign in to GitHub">
        <strong>Sign in to GitHub</strong>
        <p>Sign in with your GitHub account to see pull requests{project ? ` for ${project}` : ''}.</p>
        <Button className="primary" onPress={() => setDialog(true)}>
          Sign in…
        </Button>
      </div>
    )
  else if (pulls.error?.message === GITHUB_NOT_VISIBLE)
    main = (
      <div className={`${a.card} ${s.signin}`} role="region" aria-label="GitHub App cannot see the repository">
        <p className={`${s.login} ${s.strong}`} title={`GitHub App cannot see ${project}`}>
          GitHub App cannot see {project}
        </p>
        <p>Install the GitHub App on this repository (or ask its owner to), then refresh.</p>
        <Button className="primary" onPress={() => void window.mendel['github:openInstallPage']()}>
          Install the GitHub App…
        </Button>
      </div>
    )
  else if (pulls.error)
    main = (
      <div className={`${a.card} ${s.signin}`} role="alert">
        <p>{pulls.error.message}</p>
        <Button onPress={() => void pulls.refetch()}>Retry</Button>
      </div>
    )
  else if (pr) main = <PullDetail repo={repo} project={project} pr={pr} />
  else
    main = (
      <div className={`${a.card} ${s.signin}`} role="region" aria-label="GitHub account">
        <p className={s.login} title={`Signed in as ${login}`}>
          <strong>Signed in as {login}</strong>
        </p>
        {!persisted && <p>No OS keychain available: you stay signed in for this session only.</p>}
        <Button onPress={() => void window.mendel['github:signOut']().then(refresh)}>Sign out</Button>
      </div>
    )

  return (
    <>
      <aside className={a.side}>
        {signedIn && (
          <div className={pc.sideHeader}>
            <span className={pc.grow} title={project}>
              {project}
            </span>
            <Button className="ghost" aria-label="Refresh pull requests" onPress={() => void pulls.refetch()}>
              <RefreshCw size={14} aria-hidden />
            </Button>
          </div>
        )}
        {list && !list.pulls.length && <p className={pc.empty}>No open pull requests</p>}
        {!!list?.pulls.length && (
          <ListBox
            aria-label="Pull requests"
            selectionMode="single"
            selectedKeys={pr ? [pr.number] : []}
            onSelectionChange={(k) => k !== 'all' && k.size && setSelected(Number([...k][0]))}
            className={c.list}
          >
            {list.pulls.map((p) => (
              <ListBoxItem key={p.number} id={p.number} textValue={`${p.title} #${p.number}`} className={pc.changeRow}>
                {({ isSelected }) => (
                  <>
                    {isSelected && <Highlight id="sel-pulls" />}
                    <span className={pc.changeText}>
                      <span className={pc.subject} title={p.title}>
                        {p.title}
                      </span>
                      <span className={pc.meta} title={`${p.draft ? 'Draft · ' : ''}#${p.number} · ${p.user.login} · ${ago(Date.parse(p.updated_at))}`}>
                        {p.draft && <span className={s.draft}>Draft</span>}#{p.number} · {p.user.login} · {ago(Date.parse(p.updated_at))}
                      </span>
                    </span>
                  </>
                )}
              </ListBoxItem>
            ))}
          </ListBox>
        )}
        {list?.more && (
          <Button className={`ghost ${s.more}`} onPress={() => void window.mendel['github:openPulls']({ repo })}>
            More on GitHub
          </Button>
        )}
      </aside>
      <section className={a.main}>
        <PaneBanners />
        {main}
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

/** Detail of one pull request (from the list; no extra request). The body is plain text: no Markdown, HTML or images. */
function PullDetail({ repo, project, pr }: { repo: string; project: string; pr: GithubPull }) {
  const head = pr.head.repo && pr.head.repo.full_name !== project ? `${pr.head.repo.full_name}:${pr.head.ref}` : pr.head.ref
  return (
    <div className={`${pc.detail} ${s.pull}`}>
      <header className={pc.detailHeader}>
        <h2>{pr.title}</h2>
        <div className={pc.meta} title={`${pr.draft ? 'Draft · ' : ''}#${pr.number} · ${pr.user.login} · updated ${ago(Date.parse(pr.updated_at))}`}>
          {pr.draft && <span className={s.draft}>Draft</span>}#{pr.number} · {pr.user.login} · updated {ago(Date.parse(pr.updated_at))}
        </div>
        <div className={pc.meta} title={`${head} → ${pr.base.ref}`} aria-label="Branches">
          {head} → {pr.base.ref}
        </div>
        <div className={pc.toolbarRow}>
          <Button onPress={() => void window.mendel['github:openPull']({ repo, number: pr.number })}>Open on GitHub</Button>
        </div>
      </header>
      <section aria-label="Description" className={s.body}>
        {pr.body?.trim() ? pr.body : <span className={pc.meta}>No description</span>}
      </section>
    </div>
  )
}
