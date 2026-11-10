import { expect, test } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

test('New worktree from a new branch: created next to the repo, opened, nested under it in the repo menu', async () => {
  const fx = createRepoFixture()
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const dialog = win.getByRole('dialog', { name: 'New worktree' })
  try {
    await openRepo(app, fx.work)
    await toolbar.getByRole('button', { name: /^Current branch/ }).click()
    await win.getByRole('dialog', { name: 'Branches' }).getByRole('button', { name: 'New worktree…' }).click()
    await expect(dialog).toContainText('From main')
    await expect(dialog).toContainText(fx.dir)
    await dialog.getByLabel('Branch name').fill('feat/wt')
    await expect(dialog.getByLabel('Folder name')).toHaveValue('work-feat-wt')
    await dialog.getByRole('button', { name: 'Create worktree' }).click()

    await expect(toolbar.getByRole('button', { name: /Current worktree/ })).toContainText('work · feat/wt')
    await expect(toolbar.getByRole('button', { name: 'Current branch feat/wt' })).toBeVisible()
    expect(existsSync(path.join(fx.dir, 'work-feat-wt', 'README.md'))).toBe(true)

    await toolbar.getByRole('button', { name: /Current worktree/ }).click()
    const rows = win.getByRole('dialog', { name: 'Repositories' }).getByRole('row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(fx.work)
    await expect(rows.nth(1)).toContainText('work · feat/wt')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Remove worktree: confirm, then a second confirm when it has changes; the branch is kept', async () => {
  const fx = createRepoFixture()
  const wt = path.join(fx.dir, 'wt-x')
  fx.git(['worktree', 'add', '-q', '-b', 'x', wt])
  writeFileSync(path.join(wt, 'dirty.txt'), 'x')
  const app = await launchApp(fx.env)
  const { win } = app
  const menu = win.getByRole('dialog', { name: 'Branches' })
  const openWorktrees = async () => {
    await win.getByLabel('Toolbar').getByRole('button', { name: /^Current branch/ }).click()
    await menu.getByRole('button', { name: 'Worktrees (2)' }).click()
  }
  try {
    await openRepo(app, fx.work)
    await openWorktrees()
    const list = menu.getByRole('grid', { name: 'Worktrees' })
    await expect(list.getByRole('row', { name: /^main/ })).toContainText('Main worktree')
    await expect(list.getByRole('button', { name: /^Remove worktree/ })).toHaveCount(1) // not the main (current) one

    await stubMessageBox(app.app, 1) // cancel
    await list.getByRole('button', { name: `Remove worktree ${wt}` }).click()
    await openWorktrees()
    await stubMessageBox(app.app, 0) // Remove, then Remove anyway
    await list.getByRole('button', { name: `Remove worktree ${wt}` }).click()
    await expect.poll(() => existsSync(wt)).toBe(false)
    expect(fx.git(['branch', '--list', 'x'])).toContain('x')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('A branch checked out in another worktree is marked; picking it offers to open that worktree instead of switching', async () => {
  const fx = createRepoFixture()
  const wt = path.join(fx.dir, 'wt-x')
  fx.git(['worktree', 'add', '-q', '-b', 'x', wt])
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const menu = win.getByRole('dialog', { name: 'Branches' })
  try {
    await openRepo(app, fx.work)
    await toolbar.getByRole('button', { name: /^Current branch/ }).click()
    const row = menu.getByRole('row', { name: /^x/ })
    await expect(row.getByLabel(`Checked out in ${wt}`)).toBeVisible()
    await expect(row.getByRole('button', { name: 'Delete x' })).toHaveCount(0)
    await row.click()
    await expect(win.getByText(`x is checked out in ${wt}`)).toBeVisible()
    expect(fx.git(['branch', '--show-current'])).toBe('main')
    await win.getByRole('button', { name: 'Open that worktree' }).click()
    await expect(toolbar.getByRole('button', { name: /Current worktree/ })).toContainText('work · x')
    await expect(toolbar.getByRole('button', { name: 'Current branch x' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
  }
})
