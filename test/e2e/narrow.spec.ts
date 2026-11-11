import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock } from '../fixtures/gerrit-mock'
import { mockPull, startGithubMock } from '../fixtures/github-mock'
import { createRepoFixture } from '../fixtures/repo'
import { connectGerrit, launchGerrit } from './gerrit'
import { launchApp, openRepo } from './launch'

/** Elements that overflow sideways: wider content than box (not a horizontal scroller), or poking past the window edge. */
const overflow = (win: Page) =>
  win.evaluate(() => {
    const w = document.documentElement.clientWidth
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getClientRects().length && !el.closest('.diff, [role="dialog"] pre, [hidden]'))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const ox = getComputedStyle(el).overflowX
        const clipped = el.scrollWidth > el.clientWidth + 1 && ox !== 'auto' && ox !== 'scroll' && el.clientWidth > 1 && !(el.tagName === 'SMALL' || getComputedStyle(el).textOverflow === 'ellipsis')
        return r.right > w + 1 || clipped
      })
      .map((el) => `${el.tagName}.${el.className} "${(el.textContent ?? '').slice(0, 30)}" ${el.scrollWidth}/${el.clientWidth} right=${Math.round(el.getBoundingClientRect().right)}`)
  })

type Loc = ReturnType<Page['locator']>

/** A capped detail area: scrolls on its own (overflowing, overflow-y auto) and keeps under `share` of the window height. */
const capped = async (loc: Loc, share: number) => {
  const m = await loc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY, vh: window.innerHeight }))
  expect(m.sh, 'overflows').toBeGreaterThan(m.ch + 1)
  expect(m.oy).toBe('auto')
  expect(m.ch, 'capped').toBeLessThanOrEqual(m.vh * share)
  return m.ch
}

/** Minimum window size; the repo or provider view opened by `open` afterwards. */
const minSize = async (app: Awaited<ReturnType<typeof launchApp>>) => {
  const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
  await expect.poll(() => app.win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
}

/** Click the first file, End, Enter: the last file is selected, scrolled into view inside the list, and its diff shows below. */
const lastFileByKeyboard = async (win: Page, list: Loc, last: RegExp, diff: Loc) => {
  await list.getByRole('option').first().click()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  const row = list.getByRole('option', { name: last })
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(row).toBeInViewport({ ratio: 1 })
  const [r, l] = await Promise.all([row.boundingBox(), list.boundingBox()])
  expect(r!.y + r!.height, 'last row inside the list box').toBeLessThanOrEqual(l!.y + l!.height + 1)
  await diff.scrollIntoViewIfNeeded()
  await expect(diff).toBeInViewport()
}

/** Hovers `loc`: its tooltip shows `text` fully inside the window; `null`: no tooltip shows (after the open delay). */
const tooltip = async (win: Page, loc: ReturnType<Page['locator']>, text: string | RegExp | null) => {
  await win.mouse.move(0, 0)
  await loc.hover()
  const tip = win.getByRole('tooltip')
  if (text === null) {
    await win.waitForTimeout(1000)
    await expect(tip).toHaveCount(0)
    return
  }
  await expect(tip).toHaveText(text)
  await expect(tip).toBeInViewport({ ratio: 1 })
}

/** Each sidebar tab's label: text box (from a Range over its text node) and its tab box. */
const tabLabels = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')].map((tab) => {
      const range = document.createRange()
      range.selectNodeContents([...tab.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!)
      const t = range.getBoundingClientRect()
      const b = tab.getBoundingClientRect()
      return { name: tab.textContent, left: t.left, right: t.right, tabLeft: b.left, tabRight: b.right, clipped: tab.scrollWidth > tab.clientWidth }
    })
  )

test('no horizontal overflow or clipped buttons at the minimum window width', async () => {
  const fx = createRepoFixture()
  // long trailer name (person chip) and a long branch (the commit button) must end in an ellipsis, not clip
  fx.commitFile('some/deeply/nested/folder/with-a-rather-long-file-name.txt', 'one\n', 'add file\n\nReviewed-by: Maximilian Alexander Featherstonehaugh-Montgomery <max@example.com>')
  fx.git(['checkout', '-q', '-b', 'feature/a-rather-long-branch-name-that-overflows-the-commit-button'])
  writeFileSync(path.join(fx.work, 'some/deeply/nested/folder/with-a-rather-long-file-name.txt'), 'one\ntwo\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    for (const width of [min[0]!, 900, 1080]) {
      await app.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 700), width)
      await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width)
      if (width === min[0]) await openRepo(app, fx.work)
      await win.getByRole('row', { name: /with-a-rather-long-file-name/ }).click()
      await expect(win.getByRole('region', { name: 'Unstaged diff' })).toBeVisible()
      expect(await overflow(win), `Changes at ${width}px`).toEqual([])
      await win.getByRole('tab', { name: 'History' }).click()
      await win.getByRole('row').first().click()
      expect(await overflow(win), `History at ${width}px`).toEqual([])
      await win.getByRole('tab', { name: 'Changes' }).click()
    }
    await app.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 700), min[0]!)
    await win.getByRole('button', { name: 'Settings' }).click()
    expect(await overflow(win), 'Settings').toEqual([])
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('tooltips stay inside the minimum window: icon button at the right edge, truncated text; fitting text shows none', async () => {
  const fx = createRepoFixture()
  const name = 'with-a-rather-long-file-name-that-cannot-fit-the-changes-list.txt'
  const long = `some/deeply/nested/folder/${name}`
  const deep = 'a-very-long-folder-name-that-goes-on/and-on-and-on-and-on/and-still-further-down/below/short.txt'
  fx.commitFile(long, 'one\n', 'add file')
  fx.commitFile(deep, 'one\n', 'add deep file')
  writeFileSync(path.join(fx.work, long), 'one\ntwo\n')
  writeFileSync(path.join(fx.work, deep), 'one\ntwo\n')
  writeFileSync(path.join(fx.work, 'b.txt'), 'b\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    // icon-only button: its name in the tooltip, not repeated as its description
    const settings = win.getByRole('button', { name: 'Settings' })
    await tooltip(win, settings, 'Settings')
    await expect(settings).toHaveAccessibleDescription('')
    expect(await overflow(win), 'icon button tooltip').toEqual([])
    // file rows: name first, then the folder; the full path is the row's name and its tooltip
    const longRow = win.getByRole('row', { name: long })
    await tooltip(win, longRow.getByText(name, { exact: true }), long)
    expect(await overflow(win), 'truncated text tooltip').toEqual([])
    const deepRow = win.getByRole('row', { name: deep })
    const short = deepRow.getByText('short.txt', { exact: true })
    await expect(short).toBeInViewport({ ratio: 1 })
    expect(await short.evaluate((el) => el.scrollWidth <= el.clientWidth), 'name not cut off by a long folder').toBe(true)
    expect(await longRow.getByText(name, { exact: true }).evaluate((el) => el.scrollWidth > el.clientWidth), 'a too long name is cut off').toBe(true)
    for (const row of [longRow, deepRow]) expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await tooltip(win, deepRow.getByText('a-very-long-folder-name', { exact: false }), deep)
    await tooltip(win, win.getByRole('row', { name: /b\.txt/ }).getByText('b.txt', { exact: true }), null)
    // keyboard focus shows it too; Escape hides it
    await win.mouse.move(0, 0)
    await settings.focus()
    await win.keyboard.press('Shift+Tab')
    await win.keyboard.press('Tab')
    await expect(win.getByRole('tooltip')).toHaveText('Settings')
    await win.keyboard.press('Escape')
    await expect(win.getByRole('tooltip')).toHaveCount(0)
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('GitHub Pull requests sign-in card and dialog fit the minimum window', async () => {
  const fx = createRepoFixture()
  const url = 'https://github.com/an-organization-with-a-long-name/a-repository-name-that-goes-on-and-on-and-on.git'
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const mock = await startGithubMock({ pending: 1000 })
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Pull requests' }).click()
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
    expect(await overflow(win), 'Pull requests').toEqual([])
    // four tabs on a fixed-width sidebar: labels keep a visible gap and padding inside their pill, none clipped
    const labels = await tabLabels(win)
    expect(labels.map((l) => l.name)).toEqual(['Changes', 'History', 'Stashes', 'Pull requests'])
    for (const [i, l] of labels.entries()) {
      expect(l.clipped, `${l.name} clipped`).toBe(false)
      expect(Math.min(l.left - l.tabLeft, l.tabRight - l.right), `${l.name} padding in its pill`).toBeGreaterThanOrEqual(3.5)
      if (i) expect(l.left - labels[i - 1]!.right, `gap before ${l.name}`).toBeGreaterThanOrEqual(7)
    }
    await win.getByRole('button', { name: 'Sign in…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Sign in to GitHub' })
    await expect(dialog.getByLabel('Your code')).toHaveText(mock.userCode)
    expect(await overflow(win), 'Sign-in dialog').toEqual([])
    const box = (await dialog.boundingBox())!
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size[0]! && box.y + box.height <= size[1]!, 'dialog inside the window').toBe(true)
  } finally {
    await app.close()
    await mock.close()
    fx.cleanup()
  }
})

test('Settings → Git providers fits the minimum window with a long Gerrit host and a long GitHub login', async () => {
  const fx = createRepoFixture()
  const host = 'gerrit.a-very-long-gerrit-host-name-of-some-department.example.test'
  const url = `ssh://test@${host}:29418/p/q`
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const gerrit = await startGerritMock()
  const github = await startGithubMock({ login: 'a-github-login-that-is-very-long-indeed-and-goes-on', pending: 0 })
  const userData = path.join(fx.dir, 'userData')
  mkdirSync(userData)
  // Probe result pre-cached: no network probe of the made-up host.
  writeFileSync(path.join(userData, 'providers.json'), JSON.stringify({ hosts: { [host]: { baseUrl: gerrit.url, version: '3.1.3' } } }))
  const app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData, MENDEL_E2E_GITHUB: github.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git providers' }).click()
    await expect(settings.getByRole('region', { name: 'Gerrit' })).toContainText(host)
    // Sign-in is per host: it works from a Gerrit repo too.
    const card = settings.getByRole('region', { name: 'GitHub' })
    await card.getByRole('button', { name: 'Sign in…' }).click()
    await expect(card).toContainText(`Signed in as ${github.login}`)
    expect(await overflow(win), 'Git providers').toEqual([])
    // a truncated host inside the dialog: its tooltip shows above the dialog, inside the window
    await tooltip(win, settings.getByRole('region', { name: 'Gerrit' }).getByText(host, { exact: true }), host)
    const box = (await settings.boundingBox())!
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size[0]! && box.y + box.height <= size[1]!, 'Settings inside the window').toBe(true)
  } finally {
    await app.close()
    await github.close()
    await gerrit.close()
    fx.cleanup()
  }
})

test('GitHub Pull requests list and detail fit the minimum window with very long title, branches, login and body', async () => {
  const fx = createRepoFixture()
  const url = 'https://github.com/an-organization-with-a-long-name/a-repository-name-that-goes-on-and-on-and-on.git'
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const mock = await startGithubMock({ pending: 0 })
  const title = 'A pull request title that keeps going and going well past any reasonable width of the sidebar or the main pane'
  const head = 'feature/a-very-long-head-branch-name-that-does-not-fit-anywhere-in-a-narrow-window'
  const base = 'release/a-very-long-base-branch-name-that-also-does-not-fit'
  mock.pulls = [mockPull(12345, { title, head, base, draft: true, login: 'a-github-login-that-is-very-long-indeed-and-goes-on', body: 'x'.repeat(2000) })]
  mock.more = true
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Pull requests' }).click()
    await win.getByRole('button', { name: 'Sign in…' }).click()
    // Sidebar: long project name in the header, Create pull request (main tracks origin/main) and More on GitHub.
    const create = win.getByRole('button', { name: 'Create pull request' })
    for (const b of [create, win.getByRole('button', { name: 'More on GitHub' }), win.getByRole('button', { name: 'Refresh pull requests' })]) {
      await expect(b).toBeInViewport({ ratio: 1 })
    }
    await tooltip(win, create, 'Create pull request from main')
    const project = win.getByText('an-organization-with-a-long-name/a-repository-name-that-goes-on-and-on-and-on', { exact: true })
    expect(await project.evaluate((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth), 'project ends in an ellipsis').toBe(true)
    await tooltip(win, project, 'an-organization-with-a-long-name/a-repository-name-that-goes-on-and-on-and-on')
    await tooltip(win, win.getByRole('button', { name: 'Refresh pull requests' }), 'Refresh pull requests')
    expect(await overflow(win), 'Pull requests sidebar').toEqual([])
    const row = win.getByRole('option', { name: new RegExp(title) })
    await row.click()
    await expect(win.getByRole('region', { name: 'Description' })).toBeVisible()
    expect(await overflow(win), 'Pull request selected').toEqual([])
    // Button row: Open on GitHub, Check out (disabled here: o/r is a fork of this repo) and its visible reason, all inside the window.
    for (const b of [win.getByRole('button', { name: 'Open on GitHub' }), win.getByRole('button', { name: 'Check out', exact: true }), win.getByText('Fork pull requests: check out on GitHub')]) {
      await expect(b).toBeInViewport({ ratio: 1 })
    }
    const ellipsis = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth)
    const rowTitle = row.getByText(title)
    expect(await ellipsis(rowTitle), 'row title ends in an ellipsis').toBe(true)
    await tooltip(win, rowTitle, title)
    // explicit text (data-tip): the draft badge reads as a separate word, not "Draft#12345"
    await tooltip(win, row.getByText(/#12345 · a-github-login/), /^Draft · #12345 · a-github-login-that-is-very-long-indeed-and-goes-on · /)
    const branches = win.getByLabel('Branches')
    expect(await ellipsis(branches), 'branches end in an ellipsis').toBe(true)
    // mockPull heads are o/r: from this repo that is a fork, shown as owner/repo:branch
    await tooltip(win, branches, `o/r:${head} → ${base}`)
    mock.pullsMode = 'notFound'
    await win.getByRole('button', { name: 'Refresh pull requests' }).click()
    await expect(win.getByRole('region', { name: 'GitHub App cannot see the repository' })).toBeVisible()
    expect(await overflow(win), 'Cannot see card').toEqual([])
  } finally {
    await app.close()
    await mock.close()
    fx.cleanup()
  }
})

test('GitHub signed-in card fits the minimum window with a 39-character login and a much longer one', async () => {
  const fx = createRepoFixture()
  const url = 'https://github.com/o/r.git'
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const mock = await startGithubMock({ pending: 0 })
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Pull requests' }).click()
    for (const login of ['a'.repeat(19) + '-' + 'b'.repeat(19), 'a-github-login-that-is-far-longer-than-github-allows-and-goes-on-and-on-past-the-window']) {
      mock.login = login
      await win.getByRole('button', { name: 'Sign in…' }).click()
      const card = win.getByRole('region', { name: 'GitHub account' })
      const line = card.getByText(`Signed in as ${login}`, { exact: true })
      await expect(line).toBeVisible()
      expect(await overflow(win), login).toEqual([])
      // 39 characters fit at the minimum width (no tooltip); the longer one must end in an ellipsis, full text in the tooltip
      if (login.length > 39) expect(await line.evaluate((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth), 'login ends in an ellipsis').toBe(true)
      await tooltip(win, line, login.length > 39 ? `Signed in as ${login}` : null)
      await expect(card.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 })
      await card.getByRole('button', { name: 'Sign out' }).click()
    }
  } finally {
    await app.close()
    await mock.close()
    fx.cleanup()
  }
})

test('History commit detail at the minimum window: 200 files and a 150-line message each scroll on their own, the diff stays reachable', async () => {
  const fx = createRepoFixture()
  for (let i = 0; i < 200; i++) writeFileSync(path.join(fx.work, `f${String(i).padStart(3, '0')}.txt`), `file ${i}\n`)
  fx.git(['add', '-A'])
  fx.git(['commit', '-q', '-m', ['Many files', '', ...Array.from({ length: 150 }, (_, i) => `Body line ${i + 1} explaining the change.`)].join('\n')])
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await minSize(app)
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    await win.getByRole('row', { name: /Many files/ }).click()
    const detail = win.getByLabel('Commit detail')
    const message = detail.getByRole('region', { name: 'Commit message' })
    const files = detail.getByRole('listbox', { name: 'Changed files' })
    await expect(files.getByRole('option').first()).toBeVisible()
    // both caps together leave the diff at least half the window
    const vh = await win.evaluate(() => window.innerHeight)
    expect((await capped(message, 0.2)) + (await capped(files, 0.35)), 'caps leave room for the diff').toBeLessThanOrEqual(vh / 2)
    expect(await overflow(win), 'History detail').toEqual([])
    // the message is a named tab stop that scrolls by keyboard
    await message.focus()
    await win.keyboard.press('PageDown')
    await expect.poll(() => message.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await lastFileByKeyboard(win, files, /f199\.txt/, win.getByLabel('Commit diff'))
    await expect(detail.getByRole('heading', { name: 'f199.txt' })).toBeVisible()
    // another commit and back: both start at the top again
    await win.getByRole('row', { name: /initial commit/ }).click()
    await win.getByRole('row', { name: /Many files/ }).click()
    await expect(files.getByRole('option').first()).toBeVisible()
    expect(await files.evaluate((el) => el.scrollTop)).toBe(0)
    expect(await message.evaluate((el) => el.scrollTop)).toBe(0)
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Gerrit change detail at the minimum window: 200 files and a 150-line description each scroll on their own, the diff stays reachable', async () => {
  const gerrit = await startGerritMock()
  const ch = gerrit.changes.find((c) => c._number === 101)!
  ch.revisions['b'.repeat(40)].commit.message = ['Add feature X', '', ...Array.from({ length: 150 }, (_, i) => `Body line ${i + 1} explaining the change with a long unbroken token ${'x'.repeat(120)}.`), '', 'Change-Id: I1'].join('\n')
  for (let i = 0; i < 200; i++) ch.files['b'.repeat(40)][`src/f${String(i).padStart(3, '0')}.ts`] = { lines_inserted: 1, diff: [{ ab: ['x'] }, { b: ['y'] }] }
  const g = await launchGerrit(gerrit)
  const { win } = g
  try {
    await minSize(g)
    await connectGerrit(win, gerrit)
    await win.getByRole('option', { name: /Add feature X/ }).click()
    const files = win.getByRole('listbox', { name: 'Files' })
    await expect(files.getByRole('option').first()).toBeVisible()
    const desc = win.getByRole('region', { name: 'Change description' })
    const vh = await win.evaluate(() => window.innerHeight)
    expect((await capped(desc, 0.2)) + (await capped(files, 0.35)), 'caps leave room for the diff').toBeLessThanOrEqual(vh / 2)
    expect(await overflow(win), 'Gerrit change detail').toEqual([])
    await desc.focus()
    await win.keyboard.press('PageDown')
    await expect.poll(() => desc.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await lastFileByKeyboard(win, files, /src\/f199\.ts/, win.getByRole('region', { name: 'Diff of src/f199.ts' }))
  } finally {
    await g.close()
    await gerrit.close()
  }
})
