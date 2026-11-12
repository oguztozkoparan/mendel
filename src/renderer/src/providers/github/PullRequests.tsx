import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useId, useState, type ReactNode } from 'react'
import { Button, ListBox, ListBoxItem } from 'react-aria-components'
import { GITHUB_AUTH_ERROR, GITHUB_NOT_VISIBLE, githubLink, onGithub, type GithubPull } from '../../../../shared/github'
import type { ProviderState } from '../../../../shared/ipc'
import a from '../../App.module.css'
import { refreshRepo, useBranches } from '../../Branches'
import c from '../../Changes.module.css'
import { useCopy } from '../../CommitTrailers'
import { PaneBanners } from '../../ErrorBanner'
import { Markdown } from '../../Markdown'
import md from '../../Markdown.module.css'
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
  // Branch data refetches after a push, switch or checkout; main checks the upstream again before opening the compare page.
  const branches = useBranches(repo).data
  const current = branches?.local.find((b) => b.name === branches.current)
  const remote = state.detection?.remote
  const canCreate = !!remote && !!current?.upstream?.startsWith(`${remote}/`)
  const [createError, setCreateError] = useState<string | null>(null)

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
        <p className={`${s.login} ${s.strong}`}>
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
  else if (pr) main = <PullDetail key={pr.number} repo={repo} project={project} pr={pr} />
  else
    main = (
      <div className={`${a.card} ${s.signin}`} role="region" aria-label="GitHub account">
        <p className={`${s.login} ${s.strong}`}>
          Signed in as {login}
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
            <span className={pc.grow}>
              {project}
            </span>
            <Button className="ghost" aria-label="Refresh pull requests" onPress={() => void pulls.refetch()}>
              <RefreshCw size={14} aria-hidden />
            </Button>
          </div>
        )}
        {signedIn && canCreate && (
          <Button className={s.more} onPress={() => (setCreateError(null), void window.mendel['github:createPull']({ repo }).catch((e: Error) => setCreateError(e.message)))}>
            <span data-tip={`Create pull request from ${current!.name}`}>Create pull request</span>
          </Button>
        )}
        {signedIn && canCreate && createError && (
          <p role="alert" className={`${a.error} ${s.more}`}>
            {createError}
          </p>
        )}
        {list && !list.pulls.length && <p className={pc.empty}>No open pull requests</p>}
        {!!list?.pulls.length && (
          <ListBox
            aria-label="Pull requests"
            selectionMode="single"
            selectedKeys={pr ? [pr.number] : []}
            onSelectionChange={(k) => k !== 'all' && setSelected(k.size ? Number([...k][0]) : null)}
            className={c.list}
          >
            {list.pulls.map((p) => (
              <ListBoxItem key={p.number} id={p.number} textValue={`${p.title} #${p.number}`} className={pc.changeRow}>
                {({ isSelected }) => (
                  <>
                    {isSelected && <Highlight id="sel-pulls" />}
                    <span className={pc.changeText}>
                      <span className={pc.subject}>
                        {p.title}
                      </span>
                      <span className={pc.meta} data-tip={`${p.draft ? 'Draft · ' : ''}#${p.number} · ${p.user.login} · ${ago(Date.parse(p.updated_at))}`}>
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

const FORK = 'Fork pull requests: check out on GitHub'

/** Detail of one pull request (from the list; no extra request). The body is GitHub-flavoured Markdown: no raw HTML, images not loaded. */
function PullDetail({ repo, project, pr }: { repo: string; project: string; pr: GithubPull }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const reason = useId()
  const head = pr.head.repo && pr.head.repo.full_name !== project ? `${pr.head.repo.full_name}:${pr.head.ref}` : pr.head.ref
  // Main checks again with the API's own answer; this only disables the button.
  const fork = pr.head.repo?.full_name.toLowerCase() !== project.toLowerCase()
  const checkout = () => {
    setBusy(true)
    setNotice(null)
    window.mendel['github:checkout']({ repo, number: pr.number })
      .then(
        (b) => b && setNotice({ error: false, text: `Checked out #${pr.number} on ${b}` }),
        (err: Error) => setNotice({ error: true, text: err.message })
      )
      .finally(() => (setBusy(false), void refreshRepo(qc, repo)))
  }
  return (
    <div className={`${pc.detail} ${s.pull}`}>
      <header className={pc.detailHeader}>
        <h2>{pr.title}</h2>
        <div className={pc.meta} data-tip={`${pr.draft ? 'Draft · ' : ''}#${pr.number} · ${pr.user.login} · updated ${ago(Date.parse(pr.updated_at))}`}>
          {pr.draft && <span className={s.draft}>Draft</span>}#{pr.number} · {pr.user.login} · updated {ago(Date.parse(pr.updated_at))}
        </div>
        <div className={pc.meta} aria-label="Branches">
          {head} → {pr.base.ref}
        </div>
        <div className={pc.toolbarRow}>
          <Button onPress={() => void window.mendel['github:openPull']({ repo, number: pr.number })}>Open on GitHub</Button>
          <Button isDisabled={busy || fork} aria-describedby={fork ? reason : undefined} onPress={checkout}>
            {busy ? 'Checking out…' : 'Check out'}
          </Button>
          {/* visible for keyboard users (a disabled button takes no focus); screen readers get it as the button's description */}
          {fork && (
            <span id={reason} className={pc.meta} aria-hidden>
              {FORK}
            </span>
          )}
          {notice && (
            <span role={notice.error ? 'alert' : 'status'} className={notice.error ? a.error : pc.meta}>
              {notice.text}
            </span>
          )}
        </div>
      </header>
      <section aria-label="Description" className={`${s.body} ${md.markdown}`} tabIndex={0}>
        {pr.body?.trim() ? (
          <Markdown
            gfm
            text={pr.body}
            link={({ href, children }) => (
              <BodyLink repo={repo} project={project} href={href}>
                {children}
              </BodyLink>
            )}
          />
        ) : (
          <span className={pc.meta}>No description</span>
        )}
      </section>
    </div>
  )
}

/** A link in a pull request body: main opens it when it is on github.com (and checks again); any other URL is copied, never opened. */
function BodyLink({ repo, project, href, children }: { repo: string; project: string; href?: string; children?: ReactNode }) {
  const [copied, copy] = useCopy()
  // href is '' when react-markdown's urlTransform dropped an unsafe scheme (javascript:, data:, file:...).
  // Footnote links (remark-gfm, '#user-content-fn…') are in-page anchors: plain text, not the repository page.
  const u = href ? githubLink(project, href) : null
  if (!href || !u || href.startsWith('#user-content-fn')) return <>{children}</>
  const open = onGithub(u)
  return (
    <>
      <a
        href={u.href}
        data-tip={`${u.href}\n${open ? 'Click to open' : 'Click to copy'}`}
        onClick={(e) => {
          e.preventDefault()
          if (open) void window.mendel['github:openLink']({ repo, href })
          else copy(u.href)
        }}
      >
        {children}
      </a>
      {copied && (
        <span role="status" className={s.copied}>
          Copied
        </span>
      )}
    </>
  )
}
