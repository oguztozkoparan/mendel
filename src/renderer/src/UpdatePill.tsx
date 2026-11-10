import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { UpdateState } from '../../shared/ipc'
import { PopPanel } from './motion'
import { openSettings } from './Settings'
import s from './UpdatePill.module.css'

/** Shift the panel left so it stays 12px inside the window (react-aria popovers clamp themselves). */
// Layout box, not getBoundingClientRect: the panel mounts mid scale-in animation.
const clampToWindow = (el: HTMLElement | null) => {
  if (!el) return
  const right = (el.offsetParent?.getBoundingClientRect().left ?? 0) + el.offsetLeft + el.offsetWidth
  el.style.translate = `${-Math.max(0, right - document.documentElement.clientWidth + 12)}px`
}

/** Self-contained update pill + panel (PLAN.md §3.12, §4.10), shown once an update is found. Place it anywhere in the toolbar. */
export function UpdatePill() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void window.mendel['update:state']().then(setState)
    return window.mendel.on('update:state', setState)
  }, [])

  // Checking and its result live in Settings → Updates; the toolbar only shows a found update,
  // and an error only when it ends an update the pill was already showing (a failed download must not just vanish).
  const shown = useRef(false)
  const found = state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
  if (found) shown.current = true
  else if (state.status !== 'error') shown.current = false
  if (state.status === 'error' && shown.current)
    return (
      <div className={s.root}>
        <button type="button" className={s.pill} title={state.message} onClick={() => openSettings('Updates')}>
          Update failed…
        </button>
      </div>
    )
  if (!found) return null
  return (
    <div className={s.root}>
      {state.status === 'available' && (
        <>
          <button type="button" className={s.pill} aria-expanded={open} onClick={() => setOpen(!open)}>
            Update v{state.version} available
          </button>
          <AnimatePresence>
            {open && (
              <PopPanel className={s.panel} ref={clampToWindow} role="dialog" aria-label={`mendel ${state.version}`}>
                <strong>mendel {state.version}</strong>
                {state.notes && <pre className={s.notes}>{state.notes}</pre>}
                {!state.canInstall && <p className={s.hint}>Opens the download page; install the new version by hand.</p>}
                <button type="button" onClick={() => void window.mendel['update:download']()}>
                  Download
                </button>
              </PopPanel>
            )}
          </AnimatePresence>
        </>
      )}
      {state.status === 'downloading' && (
        <span role="status">
          <progress className={s.progress} max={100} value={state.percent} aria-label="Downloading update" />{' '}
          {Math.round(state.percent)}%
        </span>
      )}
      {state.status === 'downloaded' && (
        <button type="button" className={s.pill} onClick={() => void window.mendel['update:install']()}>
          Restart to update
        </button>
      )}
    </div>
  )
}
