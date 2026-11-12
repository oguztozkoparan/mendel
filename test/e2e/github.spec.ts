import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mockPull, richBody, startGithubMock, type GithubMock } from '../fixtures/github-mock'
import { createRepoFixture } from '../fixtures/repo'
import { hoverTip, launchApp, openRepo, type LaunchedApp } from './launch'

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
async function launchGithub(mock: GithubMock, fx = createRepoFixture()) {
  fx.git(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, 'https://github.com/o/r.git'])
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  await openRepo(app, fx.work)
  await app.win.getByRole('tab', { name: 'Pull requests' }).click()
  return { ...app, fx, close: async () => (await app.close(), fx.cleanup()) }
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
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe('https://github.com/apps/mendel-desktop/installations/new')
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

test('signed in: open pull requests list, detail as Markdown, Open on GitHub and More on GitHub open main-built urls, refresh picks up changes', async () => {
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
    // Markdown, raw HTML skipped
    await expect(win.getByRole('region', { name: 'Description' })).toHaveText('not html not markdown')
    await expect(win.getByRole('region', { name: 'Description' }).locator('strong')).toHaveText('not markdown')
    await expect(win.getByRole('region', { name: 'Description' }).locator('b, img')).toHaveCount(0)
    await win.getByRole('button', { name: 'Open on GitHub' }).click()
    await expect.poll(opened).toBe('https://github.com/o/r/pull/7')
    await win.getByRole('button', { name: 'More on GitHub' }).click()
    await expect.poll(opened).toBe('https://github.com/o/r/pulls')

    // Clicking the selected pull request again deselects it: the account card with Sign out is back.
    await list.getByRole('option', { name: /Add the thing/ }).click()
    await expect(win.getByRole('heading', { name: 'Add the thing' })).toHaveCount(0)
    await expect(win.getByRole('region', { name: 'GitHub account' }).getByRole('button', { name: 'Sign out' })).toBeVisible()
    await list.getByRole('option', { name: /Add the thing/ }).click()
    await expect(win.getByRole('heading', { name: 'Add the thing' })).toBeVisible()

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

test('pull request body: GitHub-flavoured Markdown, no raw HTML or images, links open only on github.com through main', async () => {
  const mock = await startGithubMock({ pending: 0 })
  mock.pulls = [mockPull(7, { title: 'Rich body', body: richBody }), mockPull(8, { title: 'No body', body: null }), mockPull(9, { title: 'Blank body', body: '  \n ' })]
  const { app, win, close } = await launchGithub(mock)
  try {
    await app.evaluate(({ shell, clipboard }) => {
      const g = globalThis as unknown as { __opened: string[]; __copied: string[] }
      g.__opened = []
      g.__copied = []
      shell.openExternal = async (u: string) => void g.__opened.push(u)
      clipboard.writeText = async (t: string) => void g.__copied.push(t)
    })
    const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
    const copied = () => app.evaluate(() => (globalThis as unknown as { __copied: string[] }).__copied)
    const errors: string[] = []
    win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await signIn(win)
    const list = win.getByRole('listbox', { name: 'Pull requests' })
    await list.getByRole('option', { name: /Rich body/ }).click()
    const body = win.getByRole('region', { name: 'Description' })
    await expect(body.getByRole('heading', { name: 'Summary heading', level: 1 })).toBeVisible()
    await expect(body.getByRole('heading', { name: 'Changes', level: 2 })).toBeVisible()
    await expect(body.getByText('This paragraph has a soft line break')).toBeVisible() // soft break reflows
    for (const [sel, text] of [['code', 'inline code'], ['strong', 'bold'], ['em', 'italic'], ['del', 'struck'], ['blockquote', 'A quoted line']])
      await expect(body.locator(sel, { hasText: text })).toBeVisible()
    await expect(body.getByRole('listitem').filter({ hasText: 'second item' })).toBeVisible()
    const boxes = body.getByRole('checkbox')
    await expect(boxes).toHaveCount(2)
    await expect(boxes.first()).toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
    for (const b of await boxes.all()) await expect(b).toBeDisabled()
    await expect(body.getByRole('table')).toBeVisible()
    await expect(body.getByRole('columnheader', { name: 'A long column' })).toBeVisible()
    await expect(body.locator('pre code')).toContainText("const longLine = 'code-code-")
    await expect(body.locator('hr')).toHaveCount(1)
    // raw HTML is skipped, images are a text placeholder
    await expect(body.getByText('[image: diagram alt]')).toBeVisible()
    await expect(win.locator('script:not([src]), img, details, iframe')).toHaveCount(0)
    expect(await win.evaluate(() => [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.name.startsWith('on'))).length)).toBe(0)
    await expect(body).not.toContainText('alert(1)')
    await expect(body).not.toContainText('Hidden')
    await expect(body).not.toContainText('template comment')
    await expect(body).toContainText('Inline html.')
    // github.com links (relative ones resolved against the repo page) open through main; nothing else does
    await body.getByRole('link', { name: 'relative link' }).click()
    await body.getByRole('link', { name: 'github link' }).click()
    await body.getByRole('link', { name: 'https://github.com/o/r/wiki' }).click()
    await expect.poll(opened).toEqual(['https://github.com/o/r/docs/guide.md', 'https://github.com/o/r/issues/1', 'https://github.com/o/r/wiki'])
    await expect(body.getByRole('link', { name: 'script link' })).toHaveCount(0)
    await body.getByText('script link', { exact: true }).click() // its own paragraph: plain text, opens nothing
    const external = body.getByRole('link', { name: 'external link' })
    await hoverTip(win, external, 'https://example.com/page\nClick to copy')
    await external.click()
    await expect(body.getByRole('status')).toHaveText('Copied')
    expect(await copied()).toEqual(['https://example.com/page'])
    // footnote reference and back-reference are plain text (in-page anchors would resolve to the repository page)
    await expect(body.locator('sup')).toHaveText('1')
    await expect(body).toContainText('The footnote text.')
    await expect(body.locator('sup a, .footnotes a')).toHaveCount(0)
    expect(await opened()).toHaveLength(3)
    await expect(win.getByRole('heading', { name: 'Rich body' })).toBeVisible() // the renderer never navigated
    expect(errors.filter((e) => /Content.Security.Policy/i.test(e))).toEqual([])

    for (const t of ['No body', 'Blank body']) {
      await list.getByRole('option', { name: new RegExp(t) }).click()
      await expect(win.getByRole('region', { name: 'Description' })).toHaveText('No description')
    }
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
    await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe('https://github.com/apps/mendel-desktop/installations/new')
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

test('Check out puts a same-repo pull request on pr/7 tracking origin/<head>; reset and stash are asked; a fork pull request cannot be checked out', async () => {
  const mock = await startGithubMock({ pending: 0 })
  mock.pulls = [mockPull(7, { title: 'Add the thing', head: 'feat-thing' }), mockPull(8, { title: 'From a fork', head: 'feat-thing', headRepo: 'someone/r' })]
  const fx = createRepoFixture()
  // The bare remote has the pull request head on feat-thing; the user's own local feat-thing stays on main.
  const main = fx.git(['rev-parse', 'HEAD'])
  fx.git(['branch', 'feat-thing'])
  const sha = fx.commitFile('README.md', 'thing\n', 'Add the thing')
  fx.git(['push', '-q', 'origin', 'HEAD:refs/heads/feat-thing'])
  fx.git(['reset', '-q', '--hard', 'origin/main'])
  const { app, win, close } = await launchGithub(mock, fx)
  // Native confirms answer `r` and record their messages.
  const answer = async (r: number) => {
    await app.evaluate(({ dialog }, r) => {
      const g = globalThis as { __asked?: string[] }
      g.__asked = []
      dialog.showMessageBox = (async (_w: unknown, o: { message: string }) => (g.__asked!.push(o.message), { response: r, checkboxChecked: false })) as never
    }, r)
  }
  const recorded = () => app.evaluate(() => (globalThis as { __asked?: string[] }).__asked)
  try {
    await signIn(win)
    await win.getByRole('option', { name: /Add the thing/ }).click()
    const button = win.getByRole('button', { name: 'Check out', exact: true })
    await expect(button).toBeEnabled()
    await button.click()
    await expect(win.getByRole('status').filter({ hasText: 'Checked out #7 on pr/7' })).toBeVisible()
    await expect(win.getByLabel('Toolbar').getByRole('button', { name: 'Current branch pr/7' })).toBeVisible()
    expect(fx.git(['branch', '--show-current'])).toBe('pr/7')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)
    expect(fx.git(['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe('origin/feat-thing')
    expect(fx.git(['rev-parse', 'feat-thing'])).toBe(main)
    // only the number went to main; it read the head from GET /repos/o/r/pulls/7
    expect(mock.requests.some((r) => r.url === '/repos/o/r/pulls/7')).toBe(true)

    // Again: Reset is asked; Cancel keeps the branch.
    fx.commitFile('local.txt', 'mine\n', 'Local work')
    const local = fx.git(['rev-parse', 'HEAD'])
    await answer(1)
    await button.click()
    await expect(button).toBeEnabled()
    expect(await recorded()).toEqual(['Reset pr/7 to the pull request head?'])
    expect(fx.git(['branch', '--show-current'])).toBe('pr/7')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(local)

    // From main with a dirty README.md: Reset, then Stash & switch.
    fx.git(['switch', '-q', 'main'])
    writeFileSync(path.join(fx.work, 'README.md'), 'local edit\n')
    await answer(0)
    await button.click()
    await expect(win.getByRole('status').filter({ hasText: 'Checked out #7 on pr/7' })).toBeVisible()
    expect(await recorded()).toEqual(['Reset pr/7 to the pull request head?', 'Your local changes would be overwritten by the checkout.'])
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)
    expect(fx.git(['stash', 'list', '--format=%gs'])).toBe('On main: mendel-stash')
    expect(fx.git(['rev-parse', 'feat-thing'])).toBe(main)

    // Fork pull request: disabled, with its reason as the description and visible next to it.
    await win.getByRole('option', { name: /From a fork/ }).click()
    const fork = win.getByRole('button', { name: 'Check out', exact: true })
    await expect(fork).toBeDisabled()
    await expect(fork).toHaveAccessibleDescription('Fork pull requests: check out on GitHub')
    await expect(win.getByText('Fork pull requests: check out on GitHub')).toBeVisible()
    // Main refuses it on its own (the renderer only sends the number), also when the fork was deleted.
    const call = (number: number) =>
      win.evaluate(async (n) => window.mendel['github:checkout']({ repo: (await window.mendel['repo:list']()).current!, number: n }).then(String, (e: Error) => e.message), number)
    expect(await call(8)).toContain('Fork pull requests cannot be checked out yet')
    mock.pulls.push(mockPull(9, { head: 'feat-thing', headRepo: null }))
    expect(await call(9)).toContain('Fork pull requests cannot be checked out yet')
    // head.ref from the API is untrusted: it must pass the branch-name check.
    mock.pulls.push(mockPull(10, { head: '-evil' }), mockPull(11, { head: 'a..b' }))
    expect(await call(10)).toContain('Invalid branch name: -evil')
    expect(await call(11)).toContain('Invalid branch name: a..b')
    expect(fx.git(['branch', '--list', '--format=%(refname:short)', 'pr/*'])).toBe('pr/7')
  } finally {
    await close()
    await mock.close()
  }
})

test('Create pull request opens the compare page of the upstream branch; absent without an upstream, shown after Publish branch', async () => {
  const mock = await startGithubMock({ pending: 0 })
  const fx = createRepoFixture()
  fx.git(['switch', '-q', '-c', 'feat/a#b'])
  fx.git(['push', '-q', '-u', 'origin', 'feat/a#b'])
  const { app, win, close } = await launchGithub(mock, fx)
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
    })
    const opened = () => app.evaluate(() => (globalThis as { __opened?: string }).__opened)
    await signIn(win)
    const create = win.getByRole('button', { name: 'Create pull request' })
    await hoverTip(win, create, 'Create pull request from feat/a#b')
    await create.click()
    await expect.poll(opened).toBe('https://github.com/o/r/compare/feat%2Fa%23b?expand=1')

    // No upstream: no button, and main refuses on its own.
    fx.git(['switch', '-q', '-c', 'local-only'])
    await expect(win.getByLabel('Toolbar').getByRole('button', { name: 'Current branch local-only' })).toBeVisible()
    await expect(create).toHaveCount(0)
    const call = () => win.evaluate(async () => window.mendel['github:createPull']({ repo: (await window.mendel['repo:list']()).current! }).then(String, (e: Error) => e.message))
    expect(await call()).toContain('Push the branch first')

    await win.getByLabel('Toolbar').getByRole('button', { name: 'Publish branch' }).click()
    await expect(create).toBeVisible()
    await create.click()
    await expect.poll(opened).toBe('https://github.com/o/r/compare/local-only?expand=1')
  } finally {
    await close()
    await mock.close()
  }
})
