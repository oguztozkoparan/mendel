import { useEffect, useState, type FormEvent } from 'react'
import type { AuthPrompt } from '../../shared/ipc'
import s from './App.module.css'

/** Modal for git/ssh credential prompts coming from the askpass bridge; one at a time, in arrival order. */
export function AuthPromptDialog() {
  const [queue, setQueue] = useState<AuthPrompt[]>([])
  const [value, setValue] = useState('')
  useEffect(() => window.gitdock.on('auth:prompt', (p) => setQueue((q) => [...q, p])), [])

  const current = queue[0]
  if (!current) return null
  const answer = (v: string | null) => {
    void window.gitdock['auth:respond']({ id: current.id, value: v })
    setQueue((q) => q.slice(1))
    setValue('')
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    answer(current.kind === 'confirm' ? 'yes' : value)
  }

  return (
    <div className={s.backdrop}>
      <form role="dialog" aria-modal="true" aria-labelledby="auth-title" className={s.dialog} onSubmit={submit}>
        <h2 id="auth-title">Authentication required</h2>
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
    </div>
  )
}
