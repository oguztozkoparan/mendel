import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { AuthPrompt } from '../../shared/ipc'
import s from './App.module.css'

/**
 * Modal for git/ssh credential prompts coming from the askpass bridge; one at a time, in arrival order.
 * A react-aria Modal so it stacks above other modals (e.g. the clone dialog that triggered it).
 */
export function AuthPromptDialog() {
  const [queue, setQueue] = useState<AuthPrompt[]>([])
  const [value, setValue] = useState('')
  useEffect(() => window.mendel.on('auth:prompt', (p) => setQueue((q) => [...q, p])), [])
  useEffect(
    () =>
      window.mendel.on('auth:dismiss', ({ id }) =>
        setQueue((q) => {
          if (q[0]?.id === id) setValue('')
          return q.filter((p) => p.id !== id)
        })
      ),
    []
  )

  const current = queue[0]
  if (!current) return null
  const answer = (v: string | null) => {
    void window.mendel['auth:respond']({ id: current.id, value: v })
    setQueue((q) => q.slice(1))
    setValue('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    answer(current.kind === 'confirm' ? 'yes' : value)
  }

  return (
    <ModalOverlay isOpen className={s.backdrop} onOpenChange={(open) => !open && answer(null)}>
      <Modal>
        <Dialog aria-labelledby="auth-title" className={s.dialog}>
          <form className={s.form} onSubmit={submit}>
            <Heading slot="title" id="auth-title">
              Authentication required
            </Heading>
            <p className={s.muted}>{current.context}</p>
            <label htmlFor="auth-input">{current.prompt}</label>
            {current.kind !== 'confirm' && (
              <input
                id="auth-input"
                autoFocus
                type={current.kind === 'secret' ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <div className={s.actions}>
              <button type="button" onClick={() => answer(null)}>
                Cancel
              </button>
              <button type="submit" autoFocus={current.kind === 'confirm'}>
                {current.kind === 'confirm' ? 'Continue' : 'OK'}
              </button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
