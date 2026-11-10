import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('history lists commits newest first; selecting shows message, files and diff', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.txt', 'hello\n', 'Add a\n\nWhy a exists')
  const sha = fx.commitFile('b.txt', 'bee\n', 'Add b')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const list = win.getByRole('grid', { name: 'Commits' })
    await expect(list.getByRole('row')).toHaveText([/Add b.*Test User/, /Add a/, /initial commit/])
    await expect(list.getByRole('row').first()).toContainText('unpushed')
    await expect(list.getByRole('row').last()).not.toContainText('unpushed')
    const detail = win.getByLabel('Commit detail')
    await expect(detail.getByRole('button', { name: `Copy SHA ${sha}` })).toContainText(sha.slice(0, 7))
    await expect(win.getByLabel('Commit diff')).toContainText('bee')
    await detail.getByRole('button', { name: `Copy SHA ${sha}` }).click()
    await expect(detail.getByRole('button', { name: `Copied SHA ${sha}` })).toBeVisible()
    expect(await app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(sha)

    await list.getByRole('row', { name: /Add a/ }).click()
    await expect(detail.getByRole('heading', { name: 'Add a' })).toBeVisible()
    await expect(detail).toContainText('Why a exists')
    await expect(detail.getByRole('listbox', { name: 'Changed files' })).toContainText('a.txt')
    await expect(win.getByLabel('Commit diff')).toContainText('hello')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('history search by message and author:; file history from a commit file', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.txt', 'one\n', 'Add a')
  fx.commitFile('b.txt', 'bee\n', 'Add b')
  fx.commitFile('a.txt', 'two\n', 'Tweak a')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const list = win.getByRole('grid', { name: 'Commits' })
    await expect(list.getByRole('row')).toHaveCount(4)
    const msg = win.getByRole('searchbox', { name: 'Search messages' })
    await msg.fill('ADD')
    await msg.press('Enter')
    await expect(list.getByRole('row')).toHaveText([/Add b/, /Add a/])
    await msg.fill('ADD author:nobody')
    await msg.press('Enter')
    await expect(list).toContainText('No matching commits')
    await msg.press('Escape')
    await expect(list.getByRole('row')).toHaveCount(4)
    await msg.fill('ADD')
    await msg.press('Enter')
    await expect(list.getByRole('row')).toHaveCount(2)
    await msg.fill('') // what the native clear (×) reports
    await expect(list.getByRole('row')).toHaveCount(4)

    await expect(win.getByLabel('Commit detail').getByRole('heading', { name: 'Tweak a' })).toBeVisible()
    await win.getByLabel('Commit detail').getByRole('button', { name: 'File history' }).click()
    await expect(list.getByRole('row')).toHaveText([/Tweak a/, /Add a/])
    await expect(win.getByText('History of a.txt')).toBeVisible()
    await win.getByRole('button', { name: 'All files' }).click()
    await expect(list.getByRole('row')).toHaveCount(4)
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('500-commit history: first page fast, scrolling pages in the rest', async () => {
  const fx = createRepoFixture()
  const stream = Array.from(
    { length: 499 },
    (_, i) => `commit refs/heads/main\ncommitter T <t@e> ${1700000000 + i} +0000\ndata ${String(i).length + 2}\nc${i}\n\n${i === 0 ? 'from refs/heads/main^0\n' : ''}`
  ).join('')
  execFileSync('git', ['fast-import', '--quiet'], { cwd: fx.work, env: fx.env, input: stream })
  fx.git(['reset', '-q', '--hard'])
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    const t = Date.now()
    await win.getByRole('tab', { name: 'History' }).click()
    const list = win.getByRole('grid', { name: 'Commits' })
    await expect(list.getByRole('row', { name: 'c498' })).toBeVisible()
    expect(Date.now() - t).toBeLessThan(1000)
    await expect(async () => {
      await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
      await expect(list.getByRole('row', { name: 'initial commit' })).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    expect(Number(await list.getAttribute('aria-rowcount'))).toBeGreaterThanOrEqual(500)
    // A refresh (scrolled back to the top) refetches only the first page instead of all five.
    await list.evaluate((el) => (el.scrollTop = 0))
    await expect(list.getByRole('row', { name: 'c498' })).toBeVisible()
    await app.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('status:refresh')!.click())
    await expect.poll(async () => Number(await list.getAttribute('aria-rowcount'))).toBeLessThan(200)
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('large diffs are gated before parsing (History and Changes); commit file list is virtualized', async () => {
  const fx = createRepoFixture()
  const big = Array.from({ length: 6000 }, (_, i) => `line ${i}`).join('\n') + '\n'
  for (let i = 0; i < 1000; i++) writeFileSync(path.join(fx.work, `f${String(i).padStart(4, '0')}.txt`), `${i}\n`)
  fx.git(['add', '-A'])
  fx.commitFile('big.txt', big, 'Big commit')
  writeFileSync(path.join(fx.work, 'big.txt'), big.replaceAll('line', 'LINE'))
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await expect(win.getByText(/Large diff hidden \(\d+ lines\)/)).toBeVisible()

    await win.getByRole('tab', { name: 'History' }).click()
    const files = win.getByRole('listbox', { name: 'Changed files' })
    await expect(files.getByRole('option').first()).toBeVisible()
    expect(await files.getByRole('option').count()).toBeLessThan(200) // 1001 files, only visible rows rendered
    await files.getByRole('option', { name: 'big.txt' }).click() // sorted first
    const diff = win.getByLabel('Commit detail')
    await diff.getByRole('button', { name: 'Show anyway' }).click()
    await expect(win.getByLabel('Commit diff')).toContainText('line 5999')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Amend on an unpushed HEAD opens Changes with amend ticked; pushed or older commits have no Amend', async () => {
  const fx = createRepoFixture()
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const detail = win.getByLabel('Commit detail')
    await expect(detail.getByRole('heading', { name: 'initial commit' })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Amend last commit' })).toHaveCount(0) // HEAD is pushed

    fx.commitFile('a.txt', 'a\n', 'Local work\n\nDetails')
    await win.getByRole('grid', { name: 'Commits' }).getByRole('row', { name: /Local work/ }).click()
    await win.getByRole('grid', { name: 'Commits' }).getByRole('row', { name: /initial commit/ }).click()
    await expect(detail.getByRole('button', { name: 'Amend last commit' })).toHaveCount(0) // not HEAD
    await win.getByRole('grid', { name: 'Commits' }).getByRole('row', { name: /Local work/ }).click()
    await detail.getByRole('button', { name: 'Amend last commit' }).click()

    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    const form = win.getByRole('form', { name: 'Commit' })
    await expect(form.getByRole('checkbox', { name: 'Amend last commit' })).toBeChecked()
    await expect(form.getByRole('textbox', { name: 'Summary' })).toHaveValue('Local work')
    await expect(form.getByRole('textbox', { name: 'Description' })).toHaveValue('Details')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('blame a commit file; activating a line selects its commit', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.txt', 'one\ntwo\n', 'Add a')
  fx.commitFile('a.txt', 'one\nTWO\n', 'Change a')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const detail = win.getByLabel('Commit detail')
    await expect(detail.getByRole('heading', { name: 'Change a' })).toBeVisible()
    await detail.getByRole('button', { name: 'Blame' }).click()
    const blame = win.getByRole('grid', { name: 'Blame' })
    await expect(blame.getByRole('row')).toHaveText([/Test User.*1one/, /Test User.*2TWO/])
    await blame.getByRole('row').first().click()
    await expect(detail.getByRole('heading', { name: 'Add a' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('filter a commit’s changed files by path; selection kept while visible; Escape clears', async () => {
  const fx = createRepoFixture()
  for (const f of ['src/App.tsx', 'src/app.css', 'docs/README.md']) writeFileSync(path.join(fx.work, path.basename(f)), `${f}\n`)
  fx.git(['add', '-A'])
  fx.commitFile('src/Other.ts', 'other\n', 'Several files')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const detail = win.getByLabel('Commit detail')
    const files = detail.getByRole('listbox', { name: 'Changed files' })
    await expect(files.getByRole('option')).toHaveCount(4)
    await files.getByRole('option', { name: 'app.css' }).click()
    const filter = detail.getByRole('searchbox', { name: 'Filter changed files' })
    await filter.fill('APP')
    await expect(files.getByRole('option')).toHaveText([/App.tsx/, /app.css/])
    await expect(detail).toContainText('2 of 4 files')
    await expect(files.getByRole('option', { name: 'app.css' })).toHaveAttribute('aria-selected', 'true')
    await expect(win.getByLabel('Commit diff')).toContainText('src/app.css')
    await filter.fill('other')
    await expect(files.getByRole('option')).toHaveText([/src\/Other.ts/])
    await expect(files.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await expect(win.getByLabel('Commit diff')).toContainText('other')
    await filter.fill('nothing-matches')
    await expect(files).toContainText('No matching files')
    await filter.press('Escape')
    await expect(filter).toHaveValue('')
    await expect(files.getByRole('option')).toHaveCount(4)
    await expect(detail).not.toContainText('of 4 files')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('commit trailers render as chips: person card with email, Change-Id copies, URL copies without Gerrit', async () => {
  const fx = createRepoFixture()
  const changeId = 'Ie7152f0c74c598a2d6c3443c610bceac2be412cf'
  fx.commitFile('t.txt', 't\n', `Trailer commit\n\nBody line.\n\nChange-Id: ${changeId}\nReviewed-on: https://cb.example.com/c/lura/dcs/+/23288\nReviewed-by: Berkay Haberal <berkay@example.com>\nTested-by: Berkay Haberal <berkay@example.com>\nBug: 42`)
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const detail = win.getByLabel('Commit detail')
    const trailers = detail.getByLabel('Trailers')
    await expect(detail).toContainText('Body line.')
    await expect(detail.locator('pre')).not.toContainText('Change-Id')
    await expect(trailers).toContainText('Reviewed by')
    await expect(trailers).toContainText('Bug: 42')

    await trailers.getByRole('button', { name: 'Berkay Haberal, Reviewed' }).press('Enter')
    const card = win.getByRole('dialog', { name: 'Berkay Haberal' })
    await expect(card).toContainText('berkay@example.com')
    await expect(card).toContainText('Reviewed, Tested')
    await card.getByRole('button', { name: 'Copy email' }).click()
    await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('berkay@example.com')
    await win.keyboard.press('Escape')
    await expect(card).toBeHidden()

    await trailers.getByRole('button', { name: `Copy ${changeId}` }).click()
    await expect(trailers.getByRole('button', { name: `Copied ${changeId}` })).toBeVisible()
    await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(changeId)

    await trailers.getByRole('button', { name: 'Copy https://cb.example.com/c/lura/dcs/+/23288' }).click()
    await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://cb.example.com/c/lura/dcs/+/23288')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('advanced history search: change: and reviewer: match trailers; unknown qualifier hints', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.txt', 'a\n', 'Fix crash\n\nChange-Id: Iabc123def\nReviewed-by: Elena Lanets <elena@example.com>')
  fx.commitFile('b.txt', 'b\n', 'Mention Reviewed-by: Elena in the body\n\nChange-Id: I999fff')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const list = win.getByRole('grid', { name: 'Commits' })
    await expect(list.getByRole('row')).toHaveCount(3)
    const search = win.getByRole('searchbox', { name: 'Search messages' })

    await search.fill('change:Iabc')
    await search.press('Enter')
    await expect(list.getByRole('row')).toHaveText([/Fix crash/])

    await search.fill('reviewer:"elena lanets"')
    await search.press('Enter')
    await expect(list.getByRole('row')).toHaveText([/Fix crash/])

    await search.fill('change:I reviewer:nobody')
    await search.press('Enter')
    await expect(list).toContainText('No matching commits')

    await search.fill('fix: crash')
    await search.press('Enter')
    await expect(win.getByRole('alert')).toContainText('Unknown qualifier fix:')
    await search.fill('"fix crash"')
    await expect(win.getByRole('alert')).toBeHidden()
    await search.press('Enter')
    await expect(list.getByRole('row')).toHaveText([/Fix crash/])

    await win.getByRole('button', { name: 'Search help' }).click()
    await expect(win.getByRole('dialog', { name: 'Search help' })).toContainText('reviewer:<name or email>')
    await win.keyboard.press('Escape')
    await search.press('Escape')
    await expect(list.getByRole('row')).toHaveCount(3)
  } finally {
    await app.close()
    fx.cleanup()
  }
})
