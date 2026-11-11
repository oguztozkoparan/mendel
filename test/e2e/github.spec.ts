import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { mockPull, startGithubMock, type GithubMock } from '../fixtures/github-mock'
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

/** Signs in through the dialog (mock created with `pending: 0`: the first poll authorizes). */
async function signIn(win: LaunchedApp['win']) {
  await win.getByRole('region', { name: 'Sign in to GitHub' }).getByRole('button', { name: 'Sign in…' }).click()
  await expect(win.getByRole('dialog', { name: 'Sign in to GitHub' })).toHaveCount(0)
}

test('signed in: open pull requests list, detail as plain text, Open on GitHub and More on GitHub open main-built urls, refresh picks up changes', async () => {
  const mock = await startGithubMock({ pending: 0 })
  mock.pulls = [mockPull(7, { title: 'Add the thing', login: 'mona', body: '<b>not html</b>\n**not markdown**', head: 'feat-thing' }), mockPull(8, { title: 'WIP idea', draft: true })]
  mock.more = true
  const { app, win, close } = await launchGithub(mock)
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
    })
    const opened = () => app.evaluate(() => (globalThis as { __opened?: string }).__opened)
    await signIn(win)
    const list = win.getByRole('listbox', { name: 'Pull requests' })
    await expect(list.getByRole('option')).toHaveCount(2)
    await expect(list.getByRole('option').first()).toContainText('Add the thing')
    await expect(list.getByRole('option').first()).toContainText('#7 · mona')
    await expect(list.getByRole('option').nth(1)).toContainText('Draft')
    await expect(win.getByRole('region', { name: 'GitHub account' })).toContainText(`Signed in as ${mock.login}`)

    await list.getByRole('option', { name: /Add the thing/ }).click()
    const main = win.locator('section').filter({ has: win.getByRole('heading', { name: 'Add the thing' }) }).first()
    await expect(main.getByLabel('Branches')).toHaveText('feat-thing → main')
    await expect(win.getByRole('region', { name: 'Description' })).toHaveText('<b>not html</b>\n**not markdown**')
    await expect(win.getByRole('region', { name: 'Description' }).locator('b, strong, img')).toHaveCount(0)
    await win.getByRole('button', { name: 'Open on GitHub' }).click()
    await expect.poll(opened).toBe('https://github.com/o/r/pull/7')
    await win.getByRole('button', { name: 'More on GitHub' }).click()
    await expect.poll(opened).toBe('https://github.com/o/r/pulls')

    // Refetch: the selection survives while the PR is still open, and deselects once it is gone.
    mock.pulls = [mockPull(7, { title: 'Add the thing', login: 'mona', head: 'feat-thing' }), mockPull(9, { title: 'Brand new' })]
    mock.more = false
    await win.getByRole('button', { name: 'Refresh pull requests' }).click()
    await expect(list.getByRole('option', { name: /Brand new/ })).toBeVisible()
    await expect(list.getByRole('option', { name: /WIP idea/ })).toHaveCount(0)
    await expect(win.getByRole('heading', { name: 'Add the thing' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'More on GitHub' })).toHaveCount(0)
    mock.pulls = []
    await win.getByRole('button', { name: 'Refresh pull requests' }).click()
    await expect(win.getByText('No open pull requests')).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Add the thing' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Sign out' }).click()
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
    await expect(win.getByText('No open pull requests')).toHaveCount(0)
  } finally {
    await close()
    await mock.close()
  }
})

test('a repo the GitHub App cannot see shows the install card; rate limiting shows its message', async () => {
  const mock = await startGithubMock({ pending: 0 })
  mock.pullsMode = 'notFound'
  const { app, win, close } = await launchGithub(mock)
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
    })
    await signIn(win)
    const card = win.getByRole('region', { name: 'GitHub App cannot see the repository' })
    await expect(card).toContainText('GitHub App cannot see o/r')
    await card.getByRole('button', { name: 'Install the GitHub App…' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe('https://github.com/apps/trimbit/installations/new')
    mock.pullsMode = 'rateLimited'
    await win.getByRole('button', { name: 'Refresh pull requests' }).click()
    await expect(win.getByRole('alert')).toContainText(/Rate limited until \d\d:\d\d/)
    mock.pullsMode = 'ok'
    await win.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
    await expect(win.getByText('No open pull requests')).toBeVisible()
  } finally {
    await close()
    await mock.close()
  }
})
