import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, Dialog, Heading, Input, Label, Modal, ModalOverlay, Radio, RadioGroup, Tab, TabList, TabPanel, Tabs, TextField } from 'react-aria-components'
import type { Settings, UpdateState } from '../../shared/ipc'
import a from './App.module.css'
import c from './Changes.module.css'
import s from './Settings.module.css'

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => window.gitdock['settings:get']() })

function Toggle(p: { label: string; value: boolean; onChange(v: boolean): void }) {
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

/** Settings modal with sections (PLAN.md §3.11, §6). Every change is saved right away. */
export function SettingsDialog(p: { onClose(): void }) {
  const qc = useQueryClient()
  const q = useSettings()
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Settings>) =>
    void window.gitdock['settings:set'](patch).then((v) => qc.setQueryData(['settings'], v), (e: Error) => setError(e.message))
  const st = q.data
  if (!st) return null
  return (
    <ModalOverlay isOpen isDismissable onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Modal>
        <Dialog className={`${a.dialog} ${s.dialog}`} aria-labelledby="settings-title">
          <Heading slot="title" id="settings-title">
            Settings
          </Heading>
          <Tabs orientation="vertical" className={s.tabs}>
            <TabList aria-label="Sections" className={s.sections}>
              {['General', 'Git', 'Commit', 'Updates', 'Advanced'].map((t) => (
                <Tab key={t} id={t}>
                  {t}
                </Tab>
              ))}
            </TabList>
            <TabPanel id="General" className={s.panel}>
              <Choice label="Theme" value={st.theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(theme) => set({ theme })} />
              <CloneFolder />
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
            </TabPanel>
            <TabPanel id="Updates" className={s.panel}>
              <Toggle label="Check for updates automatically" value={st.autoUpdateCheck} onChange={(autoUpdateCheck) => set({ autoUpdateCheck })} />
              <UpdatesSection />
            </TabPanel>
            <TabPanel id="Advanced" className={s.panel}>
              <Button onPress={() => void window.gitdock['settings:openLogs']().catch((e: Error) => setError(e.message))}>Open logs folder</Button>
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
      </Modal>
    </ModalOverlay>
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

function CloneFolder() {
  const q = useQuery({ queryKey: ['cloneParent'], queryFn: () => window.gitdock['repo:cloneParent']({ pick: false }) })
  return (
    <Row label="Default clone folder">
      <code className={a.path}>{q.data ?? '…'}</code>
      <Button onPress={() => void window.gitdock['repo:cloneParent']({ pick: true }).then(() => q.refetch())}>Choose…</Button>
    </Row>
  )
}

function GitSection() {
  const info = useQuery({ queryKey: ['gitInfo'], queryFn: () => window.gitdock['git:info']() }).data
  const id = useQuery({ queryKey: ['gitIdentity'], queryFn: () => window.gitdock['settings:gitIdentity']() })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (id.data) (setName(id.data.name), setEmail(id.data.email))
  }, [id.data])
  const save = () =>
    void window.gitdock['settings:setGitIdentity']({ name, email }).then(() => (setMsg('Saved'), id.refetch()), (e: Error) => setMsg(e.message))
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

function UpdatesSection() {
  const version = useQuery({ queryKey: ['appInfo'], queryFn: () => window.gitdock['app:info']() }).data?.version
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => window.gitdock.on('update:state', setState), [])
  const text: Partial<Record<UpdateState['status'], string>> = { checking: 'Checking…', 'up-to-date': "You're up to date", available: 'An update is available (see the toolbar)' }
  return (
    <>
      <Row label="Current version">
        <span>v{version}</span>
      </Row>
      <div className={a.row}>
        <Button onPress={() => void window.gitdock['update:check']().then(setState)}>Check now</Button>
        {state && <span role="status">{state.status === 'error' ? state.message : (text[state.status] ?? '')}</span>}
      </div>
    </>
  )
}
