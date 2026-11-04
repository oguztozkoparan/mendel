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
    await expect(detail).toContainText(sha)
    await expect(win.getByLabel('Commit diff')).toContainText('bee')
    await detail.getByRole('button', { name: 'Copy' }).click()
    await expect(detail.getByRole('button', { name: 'Copied' })).toBeVisible()
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
