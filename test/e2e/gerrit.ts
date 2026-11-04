import { expect, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GerritMock } from '../fixtures/gerrit-mock'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, type LaunchedApp } from './launch'

export interface GerritApp extends LaunchedApp {
  fx: RepoFixture
  userData: string
}

/**
 * Repo whose origin is `ssh://test@gerrit.test:29418/p/q`, with the host's probe result pre-cached in
 * providers.json as the mock (so no network probing), opened in the app.
 */
export async function launchGerrit(mock: GerritMock): Promise<GerritApp> {
  const fx = createRepoFixture()
  fx.git(['remote', 'set-url', 'origin', 'ssh://test@gerrit.test:29418/p/q'])
  // TECH.md §5: git traffic to the Gerrit URL goes to the local bare repo; detection still sees the Gerrit remote.
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, 'ssh://test@gerrit.test:29418/p/q'])
  const userData = path.join(mkdtempSync(path.join(tmpdir(), 'gitdock-ud-')), 'userData')
  mkdirSync(userData)
  writeFileSync(path.join(userData, 'providers.json'), JSON.stringify({ hosts: { 'gerrit.test': { baseUrl: mock.url, version: '3.1.3' } } }))
  const app = await launchApp({ ...fx.env, GITDOCK_E2E_USERDATA: userData })
  await openRepo(app, fx.work)
  return {
    ...app,
    fx,
    userData,
    close: async () => {
      await app.close()
      fx.cleanup()
      rmSync(path.dirname(userData), { recursive: true, force: true })
    }
  }
}

/** Reviews tab → Connect… → password → Test & save → Close. */
export async function connectGerrit(win: Page, mock: GerritMock, password = mock.password): Promise<void> {
  await win.getByRole('tab', { name: 'Reviews' }).click()
  await win.getByRole('region', { name: 'Connect to Gerrit' }).getByRole('button', { name: 'Connect…' }).click()
  const dialog = win.getByRole('dialog', { name: /Connect to Gerrit/ })
  await dialog.getByLabel('HTTP password / token').fill(password)
  await dialog.getByRole('button', { name: 'Test & save' }).click()
  await expect(dialog.getByRole('status')).toContainText('Connected as')
  await dialog.getByRole('button', { name: 'Close' }).click()
}

/** Commit `name` with the Change-Id of mock change `n` (`I000…0n`). */
export const commitForChange = (fx: RepoFixture, name: string, n: number, subject = `Add ${name}`) =>
  fx.commitFile(name, `${name}\n`, `${subject}\n\nChange-Id: I${String(n).padStart(40, '0')}`)

/** The bare remote prints Gerrit-style push output (`remote:   <url> subject [NEW]`) after each push. */
export function gerritPushOutput(fx: RepoFixture, line: string): void {
  const hook = path.join(fx.remote, 'hooks', 'post-receive')
  writeFileSync(hook, `#!/bin/sh\necho "" >&2\necho "  ${line}" >&2\n`)
  chmodSync(hook, 0o755)
}
