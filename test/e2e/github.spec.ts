import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { startGithubMock, type GithubMock } from '../fixtures/github-mock'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, type LaunchedApp } from './launch'

test('github.com remote → GitHub provider row, Pull requests tab and no Reviews tab; still GitHub after a relaunch', async () => {
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
    await expect(win.getByRole('tab', { name: 'Pull requests' })).toBeVisible()
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

/** github.com repo opened with both GitHub origins pointed at `mock` (e2e seam), on its Pull requests tab. */
async function launchGithub(mock: GithubMock) {
  const fx = createRepoFixture()
  fx.git(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, 'https://github.com/o/r.git'])
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  await openRepo(app, fx.work)
  await app.win.getByRole('tab', { name: 'Pull requests' }).click()
  return { ...app, close: async () => (await app.close(), fx.cleanup()) }
}

test('Pull requests → Sign in → device code → authorized → Signed in as; Sign out returns to the card', async () => {
  const mock = await startGithubMock({ pending: 1000 })
  const { app, win, close } = await launchGithub(mock)
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
    })
    await win.getByRole('region', { name: 'Sign in to GitHub' }).getByRole('button', { name: 'Sign in…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Sign in to GitHub' })
    await expect(dialog.getByLabel('Your code')).toHaveText(mock.userCode)
    await dialog.getByRole('button', { name: 'Open GitHub' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe('https://github.com/login/device')
    mock.pending = 0
    await expect(dialog).toHaveCount(0)
    await expect(win.getByRole('region', { name: 'GitHub account' })).toContainText(`Signed in as ${mock.login}`)
    await win.getByRole('button', { name: 'Sign out' }).click()
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
  } finally {
    await close()
    await mock.close()
  }
})

test('a sign-in denied on GitHub shows the message; Cancel closes the dialog and stops polling', async () => {
  const mock = await startGithubMock({ pending: 0, outcome: 'denied' })
  const { win, close } = await launchGithub(mock)
  try {
    await win.getByRole('button', { name: 'Sign in…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Sign in to GitHub' })
    await expect(dialog.getByRole('alert')).toHaveText('Sign-in was cancelled on GitHub.')
    mock.pending = 1000
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog.getByLabel('Your code')).toHaveText(mock.userCode)
    await expect.poll(() => mock.polls()).toBeGreaterThan(1)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    const polls = mock.polls()
    await win.waitForTimeout(2500)
    expect(mock.polls()).toBe(polls)
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
  } finally {
    await close()
    await mock.close()
  }
})

test('Settings → Git providers → GitHub: sign in shows on the Pull requests tab, sign out, Install the GitHub App opens its install page', async () => {
  const mock = await startGithubMock({ pending: 1000 })
  const { app, win, close } = await launchGithub(mock)
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
    })
    const settings = win.getByRole('dialog', { name: 'Settings' })
    const card = settings.getByRole('region', { name: 'GitHub' })
    const open = async () => {
      await win.getByRole('button', { name: 'Settings' }).click()
      await settings.getByRole('tab', { name: 'Git providers' }).click()
    }
    await open()
    await expect(card).toContainText('github.com')
    await expect(card).toContainText('Not signed in')
    await card.getByRole('button', { name: 'Sign in…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Sign in to GitHub' })
    await expect(dialog.getByLabel('Your code')).toHaveText(mock.userCode)
    mock.pending = 0
    await expect(dialog).toHaveCount(0)
    await expect(card).toContainText(`Signed in as ${mock.login}`)
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(win.getByRole('region', { name: 'GitHub account' })).toContainText(`Signed in as ${mock.login}`)

    await open()
    await card.getByRole('button', { name: 'Sign out' }).click()
    await expect(card).toContainText('Not signed in')
    await card.getByRole('button', { name: 'Install the GitHub App…' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe('https://github.com/apps/trimbit/installations/new')
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
  } finally {
    await close()
    await mock.close()
  }
})
