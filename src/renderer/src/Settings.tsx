import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Checkbox, Dialog, Heading, Input, Label, Radio, RadioGroup, Tab, TabList, TabPanel, Tabs, TextField } from 'react-aria-components'
import type { Settings, UpdateState } from '../../shared/ipc'
import a from './App.module.css'
import c from './Changes.module.css'
import { GerritConnectDialog } from './providers/gerrit/GerritConnectDialog'
import { RepoProviderDialog } from './providers/gerrit/RepoProviderDialog'
import { SignInDialog } from './providers/github/SignInDialog'
import s from './Settings.module.css'
import { Segmented } from './controls'
import { DialogShell, Highlight, withTransition } from './motion'

/** Open the Settings dialog on `section` from anywhere in the renderer (App owns the dialog). */
export const openSettings = (section: string) => window.dispatchEvent(new CustomEvent('mendel:settings', { detail: section }))

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => window.mendel['settings:get']() })

export function Toggle(p: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <Checkbox isSelected={p.value} onChange={p.onChange} className={c.amend}>
      <span className={c.box} aria-hidden>
        {p.value ? '✓' : ''}
      </span>
      {p.label}
    </Checkbox>
  )
}

function Choice<T extends string | number>(p: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <RadioGroup value={String(p.value)} onChange={(v) => p.onChange(p.options.find(([o]) => String(o) === v)![0])} className={s.radios}>
      <Label>{p.label}</Label>
      {p.options.map(([o, text]) => (
        <Radio key={String(o)} value={String(o)} className={s.radio}>
          {text}
        </Radio>
      ))}
    </RadioGroup>
  )
}

/** Soft themes are token overrides on top of their base scheme (global.css); the others clear them. */
export const applyTheme = (theme: Settings['theme']) =>
  theme.startsWith('soft-') ? (document.documentElement.dataset.theme = theme) : delete document.documentElement.dataset.theme

/** Resolves when the OS-level color scheme flips after a theme change, or after 200ms when it does not change. */
const schemeChange = () =>
  new Promise<void>((done) => {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => done(), { once: true })
    setTimeout(done, 200)
  })

/** Settings modal with sections (PLAN.md §3.11, §6). Every change is saved right away. */
export function SettingsDialog(p: { repo?: string; section?: string; onClose(): void }) {
  const qc = useQueryClient()
  const q = useSettings()
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Settings>) =>
    window.mendel['settings:set'](patch).then((v) => void qc.setQueryData(['settings'], v), (e: Error) => setError(e.message))
  const st = q.data
  if (!st) return null
  return (
    <DialogShell isDismissable onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Dialog className={`${a.dialog} ${s.dialog}`} aria-labelledby="settings-title">
        <Heading slot="title" id="settings-title">
          Settings
        </Heading>
        <Tabs orientation="vertical" defaultSelectedKey={p.section} className={s.tabs}>
          <TabList aria-label="Sections" className={s.sections}>
            {['General', 'Git', 'Commit', 'Git providers', 'Updates', 'Advanced'].map((t) => (
              <Tab key={t} id={t}>
                {({ isSelected }) => (
                  <>
                    {isSelected && <Highlight id="settings-tab" />}
                    {t}
                  </>
                )}
              </Tab>
            ))}
          </TabList>
          <TabPanel id="General" className={s.panel}>
            <Choice
              label="Theme"
              value={st.theme}
              options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['soft-dark', 'Soft dark'], ['soft-light', 'Soft light']]}
              onChange={(theme) =>
                withTransition(() => {
                  applyTheme(theme)
                  // Dark <-> Soft dark (or Light <-> Soft light) keeps the OS scheme: nothing to wait for.
                  const same = theme !== 'system' && theme.endsWith('dark') === matchMedia('(prefers-color-scheme: dark)').matches
                  return Promise.all([same || schemeChange(), set({ theme })])
                })
              }
            />
            <Row label="Accent">
              <Segmented
                label="Accent"
                value={st.accent}
                options={[['cyan', 'Cyan'], ['cobalt', 'Cobalt'], ['violet', 'Violet'], ['fuchsia', 'Fuchsia'], ['graphite', 'Graphite']]}
                onChange={(accent) => withTransition(() => ((document.documentElement.dataset.accent = accent), set({ accent })))}
              />
            </Row>
            <CloneFolder />
            <ToolChoice kind="editor" st={st} set={set} onError={setError} />
            <ToolChoice kind="terminal" st={st} set={set} onError={setError} />
            <Toggle label="Reopen last repository on start" value={st.reopenLastRepo} onChange={(reopenLastRepo) => set({ reopenLastRepo })} />
            <Toggle label="Confirm before discarding changes" value={st.confirmDiscard} onChange={(confirmDiscard) => set({ confirmDiscard })} />
          </TabPanel>
          <TabPanel id="Git" className={s.panel}>
            <GitSection />
            <Choice
              label="Auto-fetch"
              value={st.autoFetchMinutes}
              options={[[0, 'Off'], [5, 'Every 5 min'], [15, 'Every 15 min'], [30, 'Every 30 min']]}
              onChange={(autoFetchMinutes) => set({ autoFetchMinutes })}
            />
            <Choice label="Pull strategy" value={st.pullStrategy} options={[['merge', 'Merge'], ['rebase', 'Rebase']]} onChange={(pullStrategy) => set({ pullStrategy })} />
          </TabPanel>
          <TabPanel id="Commit" className={s.panel}>
            <TextField
              className={a.field}
              defaultValue={String(st.summaryLimit)}
              onChange={(v) => /^\d+$/.test(v) && Number(v) >= 20 && Number(v) <= 200 && set({ summaryLimit: Number(v) })}
            >
              <Label>Summary soft limit</Label>
              <Input type="number" min={20} max={200} className={s.number} />
            </TextField>
            <Toggle label="Spellcheck" value={st.spellcheck} onChange={(spellcheck) => set({ spellcheck })} />
            <Toggle label="Show 72-column ruler in description" value={st.descriptionRuler} onChange={(descriptionRuler) => set({ descriptionRuler })} />
          </TabPanel>
          <TabPanel id="Git providers" className={s.panel}>
            {/* One card per provider, always shown in this order; Bitbucket / GitLab get their own card when they land. */}
            <RepoSection repo={p.repo} />
            <section className={s.provider} aria-labelledby="provider-gerrit">
              <GerritSection repo={p.repo} />
              <Choice
                label="Reviews refresh"
                value={st.reviewsRefreshMinutes}
                options={[[1, 'Every minute'], [5, 'Every 5 min'], [15, 'Every 15 min'], [30, 'Every 30 min']]}
                onChange={(reviewsRefreshMinutes) => set({ reviewsRefreshMinutes })}
              />
              <Toggle label="Review notifications" value={st.reviewNotifications} onChange={(reviewNotifications) => set({ reviewNotifications })} />
            </section>
            <GithubSection repo={p.repo} />
          </TabPanel>
          <TabPanel id="Updates" className={s.panel}>
            <Toggle label="Check for updates automatically" value={st.autoUpdateCheck} onChange={(autoUpdateCheck) => set({ autoUpdateCheck })} />
            <UpdatesSection />
          </TabPanel>
          <TabPanel id="Advanced" className={s.panel}>
            <Button onPress={() => void window.mendel['settings:openLogs']().catch((e: Error) => setError(e.message))}>Open logs folder</Button>
          </TabPanel>
        </Tabs>
        {error && (
          <p role="alert" className={a.error}>
            {error}
          </p>
        )}
        <div className={a.actions}>
          <Button onPress={p.onClose}>Done</Button>
        </div>
      </Dialog>
    </DialogShell>
  )
}

function Row(p: { label: string; children: ReactNode }) {
  return (
    <div className={a.field}>
      <span>{p.label}</span>
      <div className={a.row}>{p.children}</div>
    </div>
  )
}

/** Editor / terminal (PLAN.md §6): System default, detected apps, or a custom executable picked natively in main. */
function ToolChoice(p: { kind: 'editor' | 'terminal'; st: Settings; set(patch: Partial<Settings>): void; onError(msg: string): void }) {
  const qc = useQueryClient()
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => window.mendel['settings:tools']() }).data
  const editor = p.kind === 'editor'
  const custom = editor ? p.st.editorPath : p.st.terminalPath
  const options: [string, string][] = [
    ['system', 'System default'],
    ...(tools?.[editor ? 'editors' : 'terminals'] ?? []).map((t): [string, string] => [t.id, t.name]),
    ...(custom ? [['custom', `Custom: ${custom}`] as [string, string]] : [])
  ]
  const pick = () =>
    void window.mendel['settings:pickTool']({ kind: p.kind }).then((v) => qc.setQueryData(['settings'], v), (e: Error) => p.onError(e.message))
  return (
    <>
      <Choice label={editor ? 'External editor' : 'Terminal'} value={editor ? p.st.editor : p.st.terminal} options={options} onChange={(v) => p.set(editor ? { editor: v } : { terminal: v })} />
      <div className={a.row}>
        <Button onPress={pick}>Choose custom {p.kind}…</Button>
      </div>
    </>
  )
}

function CloneFolder() {
  const q = useQuery({ queryKey: ['cloneParent'], queryFn: () => window.mendel['repo:cloneParent']({ pick: false }) })
  return (
    <Row label="Default clone folder">
      <code className={a.path}>{q.data ?? '…'}</code>
      <Button onPress={() => void window.mendel['repo:cloneParent']({ pick: true }).then(() => q.refetch())}>Choose…</Button>
    </Row>
  )
}

function GitSection() {
  const info = useQuery({ queryKey: ['gitInfo'], queryFn: () => window.mendel['git:info']() }).data
  const id = useQuery({ queryKey: ['gitIdentity'], queryFn: () => window.mendel['settings:gitIdentity']() })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (id.data) (setName(id.data.name), setEmail(id.data.email))
  }, [id.data])
  const save = () =>
    void window.mendel['settings:setGitIdentity']({ name, email }).then(() => (setMsg('Saved'), id.refetch()), (e: Error) => setMsg(e.message))
  return (
    <>
      <Row label="Git">
        <span className={a.muted}>{info?.found ? `git ${info.version} at ${info.path}` : 'Git not found'}</span>
      </Row>
      <TextField value={name} onChange={setName} className={a.field}>
        <Label>Name (user.name)</Label>
        <Input spellCheck={false} />
      </TextField>
      <TextField value={email} onChange={setEmail} className={a.field}>
        <Label>Email (user.email)</Label>
        <Input spellCheck={false} />
      </TextField>
      <div className={a.row}>
        <Button onPress={save} isDisabled={!name.trim() || !email.trim()}>
          Save identity
        </Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </>
  )
}

/** Welcome "Who are you?" (PLAN.md §4.1 step 2): shown only while the global user.name or user.email is unset. */
export function IdentityForm() {
  const id = useQuery({ queryKey: ['gitIdentity'], queryFn: () => window.mendel['settings:gitIdentity']() })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (id.data) (setName(id.data.name), setEmail(id.data.email))
  }, [id.data])
  if (!id.data || (id.data.name && id.data.email)) return null
  const save = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    window.mendel['settings:setGitIdentity']({ name, email }).then(() => id.refetch(), (err: Error) => setError(err.message))
  }
  return (
    <form className={`${a.card} ${a.form}`} aria-label="Who are you?" onSubmit={save}>
      <strong>Who are you? Used for commits</strong>
      <TextField value={name} onChange={setName} className={a.field}>
        <Label>Name</Label>
        <Input spellCheck={false} />
      </TextField>
      <TextField value={email} onChange={setEmail} className={a.field}>
        <Label>Email</Label>
        <Input spellCheck={false} />
      </TextField>
      {error && (
        <p role="alert" className={a.error}>
          {error}
        </p>
      )}
      <Button type="submit" isDisabled={!name.trim() || !email.trim()}>
        Save
      </Button>
    </form>
  )
}

const useProvider = (repo?: string) =>
  useQuery({ queryKey: ['provider', repo], queryFn: () => window.mendel['provider:get']({ repo: repo! }), enabled: !!repo })

/** "This repository" card: the open repo's detected provider and its override (PLAN.md §4.3 step 5). Provider-neutral. */
function RepoSection({ repo }: { repo?: string }) {
  const st = useProvider(repo).data
  const [dialog, setDialog] = useState(false)
  const d = st?.detection
  const name =
    d?.provider === 'gerrit'
      ? `Gerrit${d.baseUrl ? ` at ${d.baseUrl}` : ' (URL not set)'}`
      : d?.provider === 'github' && d.baseUrl
        ? `GitHub · ${new URL(d.baseUrl).host}`
        : 'No provider'
  const current = `${name} · provider setting: ${st?.override.provider}`
  return (
    <section className={s.provider} aria-labelledby="provider-repo">
      <div className={s.providerHead}>
        <strong id="provider-repo">This repository</strong>
      </div>
      {!repo && <p className={a.muted}>Open a repository to set its provider.</p>}
      {repo && st && (
        <>
          <Row label="Provider">
            <span className={a.path}>
              {current}
            </span>
          </Row>
          <div className={a.row}>
            <Button onPress={() => setDialog(true)}>Repository provider…</Button>
          </div>
          <AnimatePresence>{dialog && <RepoProviderDialog key="provider" repo={repo} state={st} onClose={() => setDialog(false)} />}</AnimatePresence>
        </>
      )}
    </section>
  )
}

/** Gerrit card header and the current repo's Gerrit account (PLAN.md §6), reusing the Reviews tab dialog. */
function GerritSection({ repo }: { repo?: string }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  const st = useProvider(repo).data
  const d = st?.detection
  const gerrit = d?.provider === 'gerrit'
  const host = gerrit ? d.host : 'Not used by this repository'
  const header = (
    <div className={s.providerHead}>
      <strong id="provider-gerrit">Gerrit</strong>
      {gerrit && <span className={s.live} aria-hidden />}
      <span className={s.providerHost}>
        {host}
      </span>
    </div>
  )
  if (!repo)
    return (
      <>
        {header}
        <p className={a.muted}>Open a repository to set up its Gerrit account.</p>
      </>
    )
  if (!st || !gerrit) return header
  const signOut = () =>
    void window.mendel['gerrit:disconnect']({ repo }).then(() => {
      void qc.invalidateQueries({ queryKey: ['provider', repo] })
      void qc.invalidateQueries({ queryKey: ['gerrit', repo] })
    })
  return (
    <>
      {header}
      <Row label="Account">
        <span className={s.grow}>{st.credentialUser ? `Connected as ${st.credentialUser}` : 'Not connected'}</span>
        {d.baseUrl && <Button onPress={() => setDialog(true)}>Connect…</Button>}
        {st.credentialUser && <Button onPress={signOut}>Sign out</Button>}
      </Row>
      <AnimatePresence>{dialog && <GerritConnectDialog key="connect" repo={repo} state={st} onClose={() => setDialog(false)} />}</AnimatePresence>
    </>
  )
}

/** GitHub card: the account (per host, not per repo, so it works with any repo or none) and the app install page. */
function GithubSection({ repo }: { repo?: string }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  /** false right after a sign-in without a usable OS keychain. */
  const [persisted, setPersisted] = useState(true)
  const d = useProvider(repo).data?.detection
  const github = d?.provider === 'github'
  const host = github ? d.host : 'Not used by this repository'
  // Same query key as the Pull requests tab: signing in or out in one place updates the other.
  const account = useQuery({ queryKey: ['githubAccount'], queryFn: () => window.mendel['github:account']() })
  const refresh = () => qc.invalidateQueries({ queryKey: ['githubAccount'] })
  const login = account.data
  const status = login ? `Signed in as ${login}` : 'Not signed in'
  return (
    <section className={s.provider} aria-labelledby="provider-github">
      <div className={s.providerHead}>
        <strong id="provider-github">GitHub</strong>
        {github && <span className={s.live} aria-hidden />}
        <span className={s.providerHost}>
          {host}
        </span>
      </div>
      {account.isSuccess && (
        <Row label="Account">
          <span className={a.path}>
            {status}
          </span>
          {login ? (
            <Button onPress={() => void window.mendel['github:signOut']().then(refresh)}>Sign out</Button>
          ) : (
            <Button onPress={() => setDialog(true)}>Sign in…</Button>
          )}
        </Row>
      )}
      {login && !persisted && <p className={a.muted}>No OS keychain available: you stay signed in for this session only.</p>}
      <div className={a.row}>
        <Button onPress={() => void window.mendel['github:openInstallPage']()}>Install the GitHub App…</Button>
      </div>
      <p className={a.muted}>Pull requests of private repositories are visible only where the app is installed.</p>
      <AnimatePresence>
        {dialog && (
          <SignInDialog
            key="signin"
            onDone={(r) => (setPersisted(r.persisted), setDialog(false), void refresh())}
            onClose={() => setDialog(false)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function UpdatesSection() {
  const version = useQuery({ queryKey: ['appInfo'], queryFn: () => window.mendel['app:info']() }).data?.version
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  useEffect(() => {
    void window.mendel['update:state']().then(setState)
    return window.mendel.on('update:state', setState)
  }, [])
  const check = () => void window.mendel['update:check']().then(setState)
  const busy = state.status === 'checking' || state.status === 'downloading'
  return (
    <>
      <Row label="Current version">
        <span>v{version}</span>
      </Row>
      <div className={`${a.row} ${s.status}`}>
        <Button isDisabled={busy} onPress={check}>
          Check for updates
        </Button>
        {state.status === 'checking' && <span role="status">Checking for updates…</span>}
        {state.status === 'up-to-date' && <span role="status">You're up to date (v{state.version})</span>}
        {state.status === 'available' && <span role="status">Update v{state.version} available: open it from the toolbar</span>}
        {state.status === 'downloading' && <span role="status">Downloading update…</span>}
        {state.status === 'downloaded' && <span role="status">Update ready: restart from the toolbar</span>}
      </div>
      {state.status === 'error' && (
        <p role="alert" className={a.error}>
          Update check failed: {state.message}{' '}
          <Button onPress={check}>Retry</Button>
        </p>
      )}
    </>
  )
}
