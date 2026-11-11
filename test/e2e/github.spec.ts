import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, type LaunchedApp } from './launch'

test('github.com remote → GitHub provider row, no Reviews tab; still GitHub after a relaunch', async () => {
  const fx = createRepoFixture()
  const url = 'https://github.com/o/r.git'
  fx.git(['remote', 'set-url', 'origin', url])
  // No network: git traffic to github.com goes to the local bare repo; detection still sees the GitHub remote.
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const userData = path.join(fx.dir, 'userData')
  let app: LaunchedApp | null = null
  const check = async ({ win }: LaunchedApp) => {
    await expect(win.getByRole('tab', { name: 'Changes' })).toBeVisible()
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git providers' }).click()
    await expect(settings).toContainText('GitHub · api.github.com · provider setting: auto')
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(win.getByRole('tab', { name: 'Reviews' })).toHaveCount(0)
  }
  try {
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await openRepo(app, fx.work)
    await check(app)
    await app.close()
    app = null
    // The Gerrit host cache must not hold github.com (it would come back as Gerrit).
    const store = path.join(userData, 'providers.json')
    expect(existsSync(store) ? (JSON.parse(readFileSync(store, 'utf8')).hosts ?? {}) : {}).toEqual({})
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await check(app)
  } finally {
    await app?.close()
    fx.cleanup()
  }
})
