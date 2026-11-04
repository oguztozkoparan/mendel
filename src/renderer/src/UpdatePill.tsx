import { useEffect, useState } from 'react'
import type { UpdateState } from '../../shared/ipc'
import s from './UpdatePill.module.css'

/** Self-contained update pill + panel (PLAN.md §3.12, §4.10). Place it anywhere in the toolbar. */
export function UpdatePill() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void window.gitdock['update:state']().then(setState)
    return window.gitdock.on('update:state', setState)
  }, [])
  const check = () => void window.gitdock['update:check']().then(setState)

  return (
    <div className={s.root}>
      {state.status === 'idle' && (
        <button type="button" className={s.link} onClick={check}>
          Check for updates
        </button>
      )}
      {state.status === 'checking' && <span role="status">Checking for updates…</span>}
      {state.status === 'up-to-date' && <span role="status">You're up to date (v{state.version})</span>}
      {state.status === 'error' && (
        <span role="alert" className={s.error}>
          Update check failed: {state.message}{' '}
          <button type="button" onClick={check}>
            Retry
          </button>
        </span>
      )}
      {state.status === 'available' && (
        <>
          <button type="button" className={s.pill} aria-expanded={open} onClick={() => setOpen(!open)}>
            Update v{state.version} available
          </button>
          {open && (
            <div className={s.panel} role="dialog" aria-label={`gitdock ${state.version}`}>
              <strong>gitdock {state.version}</strong>
              {state.notes && <pre className={s.notes}>{state.notes}</pre>}
              {!state.canInstall && <p className={s.hint}>Opens the download page; install the new version by hand.</p>}
              <button type="button" onClick={() => void window.gitdock['update:download']()}>
                Download
              </button>
            </div>
          )}
        </>
      )}
      {state.status === 'downloading' && (
        <span role="status">
          <progress className={s.progress} max={100} value={state.percent} aria-label="Downloading update" />{' '}
          {Math.round(state.percent)}%
        </span>
      )}
      {state.status === 'downloaded' && (
        <button type="button" className={s.pill} onClick={() => void window.gitdock['update:install']()}>
          Restart to update
        </button>
      )}
    </div>
  )
}
