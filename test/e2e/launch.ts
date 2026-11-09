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
 * (pass `MENDEL_E2E_USERDATA` to relaunch with the same app state). `args` follow the main script (`mendel <dir>`).
 */
export async function launchApp(env: NodeJS.ProcessEnv = {}, args: string[] = []): Promise<LaunchedApp> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mendel-e2e-'))
  const app = await electron.launch({
    args: ['out/main/index.js', ...args],
    env: { ...isolatedGitEnv(tmp), MENDEL_E2E_USERDATA: path.join(tmp, 'userData'), ...env }
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

/** Open `dir` through the welcome screen's "Open local repository…" (native dialog stubbed). */
export async function openRepo({ app, win }: Pick<LaunchedApp, 'app' | 'win'>, dir: string): Promise<void> {
  await stubOpenDialog(app, dir)
  await win.getByRole('button', { name: 'Open local repository…' }).click()
  await win.getByRole('tab', { name: 'Changes' }).waitFor()
}
