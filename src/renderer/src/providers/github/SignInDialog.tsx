import { useEffect, useState } from 'react'
import { Button, Dialog, Heading } from 'react-aria-components'
import { GITHUB_ACCESS_DENIED, GITHUB_CODE_EXPIRED, type GithubDeviceCode, type GithubSignedIn } from '../../../../shared/github'
import a from '../../App.module.css'
import { useCopy } from '../../CommitTrailers'
import { DialogShell } from '../../motion'
import s from './GitHub.module.css'

type Step = { k: 'starting' } | { k: 'waiting'; code: GithubDeviceCode } | { k: 'expired' } | { k: 'denied' } | { k: 'error'; message: string }

/**
 * GitHub App device flow: main asks GitHub for a code, the user types it at github.com/login/device, main polls.
 * Only the user code reaches the renderer. Closing the dialog cancels the sign-in.
 */
export function SignInDialog(p: { onDone(r: GithubSignedIn): void; onClose(): void }) {
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState<Step>({ k: 'starting' })
  const [copied, copy] = useCopy()
  useEffect(() => {
    let live = true
    setStep({ k: 'starting' })
    window.mendel['github:signIn']()
      .then((code) => {
        if (!live) return
        setStep({ k: 'waiting', code })
        return window.mendel['github:wait']().then((r) => live && p.onDone(r))
      })
      .catch((err: Error) => {
        if (!live) return
        if (err.message === GITHUB_CODE_EXPIRED) setStep({ k: 'expired' })
        else if (err.message === GITHUB_ACCESS_DENIED) setStep({ k: 'denied' })
        else setStep({ k: 'error', message: err.message })
      })
    return () => {
      live = false
      void window.mendel['github:cancel']()
    }
  }, [attempt])
  const retry = () => setAttempt((n) => n + 1)

  return (
    <DialogShell isDismissable className={a.backdrop} onOpenChange={(o) => !o && p.onClose()}>
      <Dialog aria-labelledby="github-signin-title" className={a.dialog}>
        <Heading slot="title" id="github-signin-title">
          Sign in to GitHub
        </Heading>
        {step.k === 'starting' && <p role="status">Getting a code from GitHub…</p>}
        {step.k === 'waiting' && (
          <>
            <p className={s.hint}>Open GitHub and enter this code:</p>
            <div className={s.code}>
              <output aria-label="Your code">{step.code.userCode}</output>
              <Button aria-label={copied ? 'Copied' : 'Copy code'} onPress={() => copy(step.code.userCode)}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p role="status" className={s.hint}>
              Waiting for you to authorize Mendel on GitHub…
            </p>
          </>
        )}
        {step.k === 'expired' && <p role="alert" className={a.error}>The code has expired. Get a new code to try again.</p>}
        {step.k === 'denied' && <p role="alert" className={a.error}>Sign-in was cancelled on GitHub.</p>}
        {step.k === 'error' && (
          <p role="alert" className={a.error}>
            {step.message}
          </p>
        )}
        <div className={a.actions}>
          <Button onPress={p.onClose}>Cancel</Button>
          {step.k === 'waiting' && (
            <Button className="primary" onPress={() => void window.mendel['github:openDevicePage']()}>
              Open GitHub
            </Button>
          )}
          {(step.k === 'expired' || step.k === 'denied' || step.k === 'error') && (
            <Button className="primary" onPress={retry}>
              {step.k === 'expired' ? 'Get a new code' : 'Try again'}
            </Button>
          )}
        </div>
      </Dialog>
    </DialogShell>
  )
}
