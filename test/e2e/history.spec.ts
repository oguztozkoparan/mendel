import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
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
  } finally {
    await app.close()
    fx.cleanup()
  }
})
