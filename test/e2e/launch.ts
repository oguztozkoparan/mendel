import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isolatedGitEnv } from '../fixtures/git-env'

export interface LaunchedApp {
  app: ElectronApplication
  win: Page
  close(): Promise<void>
}

/**
 * Launch the built app (`out/main/index.js`) with a throwaway userData dir and git isolated from the
 * developer's config. Pass a RepoFixture's `env` to share its git config; extra vars override
 * (pass `GITDOCK_E2E_USERDATA` to relaunch with the same app state).
 */
export async function launchApp(env: NodeJS.ProcessEnv = {}): Promise<LaunchedApp> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'gitdock-e2e-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...isolatedGitEnv(tmp), GITDOCK_E2E_USERDATA: path.join(tmp, 'userData'), ...env }
  })
  const win = await app.firstWindow()
  return {
    app,
    win,
    close: async () => {
      await app.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/** Native folder pickers return `dir` from now on (null = user cancelled). */
export function stubOpenDialog(app: ElectronApplication, dir: string | null): Promise<void> {
  return app.evaluate(({ dialog }, d) => {
    dialog.showOpenDialog = (async () => ({ canceled: d === null, filePaths: d ? [d] : [] })) as never
  }, dir)
}

/** Native message boxes (confirms) answer with button index `response` from now on. */
export function stubMessageBox(app: ElectronApplication, response: number): Promise<void> {
  return app.evaluate(({ dialog }, r) => {
    dialog.showMessageBox = (async () => ({ response: r, checkboxChecked: false })) as never
  }, response)
}
