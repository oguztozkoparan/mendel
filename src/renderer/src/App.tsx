import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Settings as Gear } from 'lucide-react'
import { Button } from 'react-aria-components'
import type { GerritSent } from '../../shared/gerrit'
import type { GitInfo } from '../../shared/ipc'
import s from './App.module.css'
import { AuthPromptDialog } from './AuthPromptDialog'
import { BranchSelector, refreshLocal, refreshRepo, StashBanner } from './Branches'
import { CloneDialog } from './CloneDialog'
import { ConflictBanner } from './Conflicts'
import { RepoList, RepoSelector, type RepoActions } from './Repos'
import { useMenuCommand } from './menu'
import { SendForReview } from './providers/gerrit/SendForReview'
import { RepoView } from './RepoView'
import { SettingsDialog } from './Settings'
import { SyncButton, type Notice } from './SyncButton'
import { UpdatePill } from './UpdatePill'

const INSTALL_HINT: Record<string, string> = {
  darwin: 'Install Git with Xcode Command Line Tools (xcode-select --install) or Homebrew (brew install git).',
  win32: 'Install Git for Windows from https://git-scm.com/download/win or run: winget install Git.Git',
  linux: 'Install Git with your package manager, e.g. sudo apt install git.'
}

export function App() {
  const qc = useQueryClient()
  const [git, setGit] = useState<GitInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [settings, setSettings] = useState(false)
  const [sending, setSending] = useState(false)
  /** "Open change #N" from the send toast: RepoView switches to Reviews and selects it. */
  const [focus, setFocus] = useState<{ change: number } | null>(null)
  useEffect(() => window.gitdock.on('repo:changed', (e) => void refreshLocal(qc, e.repo)), [qc])
  useEffect(
    () =>
      window.gitdock.on('repo:watchOff', () =>
        setNotice({ text: 'Auto-refresh is off: too many folders to watch (raise fs.inotify.max_user_watches). Changes refresh when you return to the window or use View → Refresh.' })
      ),
    []
  )
  const check = (recheck = false) => void window.gitdock['git:info']({ recheck }).then(setGit)
  useEffect(() => check(), [])
  const usable = git?.found === true && git.supported
  const list = useQuery({ queryKey: ['repos'], queryFn: () => window.gitdock['repo:list'](), enabled: usable })
  const repos = list.data?.repos ?? []
  const current = repos.find((r) => r.id === list.data?.current)
  const provider = useQuery({ queryKey: ['provider', current?.id], queryFn: () => window.gitdock['provider:get']({ repo: current!.id }), enabled: !!current })
  const gerrit = provider.data?.detection?.provider === 'gerrit'
  const sent = (r: GerritSent) => {
    setSending(false)
    const n = r.number
    if (r.status === 'no-changes') setNotice({ text: 'Nothing changed since last patchset' })
    else if (!n) setNotice({ text: 'Sent for review' })
    else setNotice({ text: r.updated ? `New patchset uploaded to #${n}` : `Created change #${n}`, action: { label: `Open change #${n}`, run: () => setFocus({ change: n }) } })
  }

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.then(
      () => qc.invalidateQueries({ queryKey: ['repos'] }),
      (e: Error) => setError(e.message)
    )
  }
  const actions: RepoActions = {
    add: (locate) => run(window.gitdock['repo:add'](locate ? { locate } : undefined)),
    open: (id) => run(window.gitdock['repo:open']({ id })),
    remove: (id) => run(window.gitdock['repo:remove']({ id })),
    reveal: (id) => run(window.gitdock['repo:reveal']({ id })),
    clone: () => setCloning(true)
  }
  useMenuCommand((cmd) => {
    if (cmd === 'settings') setSettings(true)
    else if (!usable) return
    else if (cmd === 'repo:open') actions.add()
    else if (cmd === 'repo:clone') actions.clone()
    else if (cmd === 'repo:reveal' && current) actions.reveal(current.id)
    else if (cmd === 'status:refresh' && current) void refreshRepo(qc, current.id)
  })

  return (
    <div className={s.app}>
      <header className={s.toolbar} aria-label="Toolbar">
        {current && <RepoSelector repos={repos} current={current} actions={actions} />}
        {current && <BranchSelector key={current.id} repo={current.id} onError={setError} />}
        {current && (
          <SyncButton
            key={current.id}
            repo={current.id}
            onError={setError}
            onNotice={setNotice}
            primary={gerrit ? { label: 'Send for review', run: () => setSending(true) } : null}
          />
        )}
        <UpdatePill />
        <Button className={`icon ${s.settings}`} aria-label="Settings" onPress={() => setSettings(true)}>
          <Gear size={16} />
        </Button>
      </header>
      {error && (
        <div role="alert" className={s.banner}>
          <span>{error}</span>
          <Button onPress={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {notice && (
        <div role="alert" className={`${s.banner} ${s.notice}`}>
          <span>{notice.text}</span>
          {notice.action && <Button onPress={() => (setNotice(null), notice.action!.run())}>{notice.action.label}</Button>}
          <Button onPress={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}
      {current && <ConflictBanner key={current.id} repo={current.id} onError={setError} />}
      {current && <StashBanner key={current.id} repo={current.id} onError={setError} />}
      {current ? (
        <RepoView key={current.id} repo={current} focus={focus} />
      ) : (
        <main className={s.welcome}>
          <h1>gitdock</h1>
          {git && !usable && (
            <div role="alert" className={s.card}>
              <strong>{git.found ? `Git ${git.version} is too old (2.30 or newer required)` : 'Git not found'}</strong>
              <p>{INSTALL_HINT[document.documentElement.dataset.platform ?? ''] ?? INSTALL_HINT.linux}</p>
              <Button onPress={() => check(true)}>Recheck</Button>
            </div>
          )}
          <div className={s.row}>
            <Button className="primary" isDisabled={!usable} onPress={() => actions.add()}>
              Open local repository…
            </Button>
            <Button isDisabled={!usable} onPress={actions.clone}>
              Clone repository…
            </Button>
          </div>
          {repos.length > 0 && (
            <div className={s.recents}>
              <h2>Recent repositories</h2>
              <RepoList repos={repos} current={null} actions={actions} />
            </div>
          )}
          {git?.found && usable && (
            <p className={s.muted}>
              git {git.version} found at {git.path}
              {git.outdated && ' — update recommended (security fixes in 2.50.1)'}
            </p>
          )}
        </main>
      )}
      {cloning && (
        <CloneDialog
          onClose={() => setCloning(false)}
          onCloned={() => (setCloning(false), void qc.invalidateQueries({ queryKey: ['repos'] }))}
        />
      )}
      {sending && current && <SendForReview repo={current.id} onClose={() => setSending(false)} onSent={sent} />}
      {settings && <SettingsDialog repo={current?.id} onClose={() => setSettings(false)} />}
      <AuthPromptDialog />
    </div>
  )
}
