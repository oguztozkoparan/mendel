import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Dialog, Heading, Input, Label, ProgressBar, TextField } from 'react-aria-components'
import type { CloneProgress } from '../../shared/ipc'
import s from './App.module.css'
import { DialogShell } from './motion'

const nameFromUrl = (url: string) => url.trim().replace(/[/\\]+$/, '').split(/[/\\:]/).pop()?.replace(/\.git$/, '') ?? ''

/** PLAN.md 3.10: URL, parent folder (native picker), editable folder name, progress + cancel. */
export function CloneDialog(p: { onClose(): void; onCloned(): void }) {
  const parent = useQuery({ queryKey: ['cloneParent'], queryFn: () => window.mendel['repo:cloneParent']({ pick: false }) })
  const [url, setUrl] = useState('')
  const [name, setName] = useState<string | null>(null) // null = follow the URL
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => window.mendel.on('repo:cloneProgress', setProgress), [])
  const folder = name ?? nameFromUrl(url)

  const pick = () => void window.mendel['repo:cloneParent']({ pick: true }).then(() => parent.refetch())
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setProgress(null)
    window.mendel['repo:clone']({ url, name: folder }).then(p.onCloned, (err: Error) => {
      setBusy(false)
      setError(err.message)
    })
  }
  const cancel = () => (busy ? void window.mendel['repo:cloneCancel']() : p.onClose())

  return (
    <DialogShell className={s.backdrop} isDismissable={false}>
      <Dialog className={s.dialog} aria-labelledby="clone-title">
        <form onSubmit={submit} className={s.form}>
          <Heading slot="title" id="clone-title">
            Clone repository
          </Heading>
          <TextField value={url} onChange={setUrl} isDisabled={busy} autoFocus className={s.field}>
            <Label>Repository URL</Label>
            <Input placeholder="https://host/project.git or user@host:project.git" spellCheck={false} />
          </TextField>
          <div className={s.field}>
            <span>Parent folder</span>
            <div className={s.row}>
              <code className={s.path}>{parent.data ?? '…'}</code>
              <Button onPress={pick} isDisabled={busy}>
                Choose…
              </Button>
            </div>
          </div>
          <TextField value={folder} onChange={setName} isDisabled={busy} className={s.field}>
            <Label>Folder name</Label>
            <Input spellCheck={false} />
          </TextField>
          {busy && (
            <ProgressBar aria-label="Clone progress" value={progress?.percent ?? 0} isIndeterminate={!progress} className={s.progress}>
              {progress ? `${progress.phase}: ${progress.percent}%` : 'Cloning…'}
            </ProgressBar>
          )}
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <div className={s.actions}>
            <Button onPress={cancel}>Cancel</Button>
            <Button type="submit" className="primary" isDisabled={busy || !url.trim() || !folder.trim()}>
              Clone
            </Button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}
