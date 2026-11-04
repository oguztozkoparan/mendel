import { useEffect, useState } from 'react'
import type { GitInfo } from '../../shared/ipc'
import s from './App.module.css'

const INSTALL_HINT: Record<string, string> = {
  darwin: 'Install Git with Xcode Command Line Tools (xcode-select --install) or Homebrew (brew install git).',
  win32: 'Install Git for Windows from https://git-scm.com/download/win or run: winget install Git.Git',
  linux: 'Install Git with your package manager, e.g. sudo apt install git.'
}

export function App() {
  const [git, setGit] = useState<GitInfo | null>(null)
  const check = (recheck = false) => void window.gitdock['git:info']({ recheck }).then(setGit)
  useEffect(() => check(), [])
  const usable = git?.found === true && git.supported

  return (
    <div className={s.app}>
      <header className={s.toolbar} aria-label="Toolbar" />
      <main className={s.welcome}>
        <h1>gitdock</h1>
        {git && !usable && (
          <div role="alert" className={s.card}>
            <strong>{git.found ? `Git ${git.version} is too old (2.30 or newer required)` : 'Git not found'}</strong>
            <p>{INSTALL_HINT[document.documentElement.dataset.platform ?? ''] ?? INSTALL_HINT.linux}</p>
            <button type="button" onClick={() => check(true)}>
              Recheck
            </button>
          </div>
        )}
        <button type="button" disabled>
          Open local repository…
        </button>
        {git?.found && usable && (
          <p className={s.muted}>
            git {git.version} found at {git.path}
            {git.outdated && ' — update recommended (security fixes in 2.50.1)'}
          </p>
        )}
      </main>
    </div>
  )
}
