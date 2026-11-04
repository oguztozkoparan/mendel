import { expect, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
