import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

test('create, switch, stash & switch with restore, delete', async () => {
  const fx = createRepoFixture()
  fx.git(['switch', '-q', '-c', 'other'])
  fx.commitFile('README.md', 'other\n')
  fx.git(['switch', '-q', 'main'])
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const menu = win.getByRole('dialog', { name: 'Branches' })
  const open = () => toolbar.getByRole('button', { name: /^Current branch/ }).click()
  const head = () => fx.git(['branch', '--show-current'])
  try {
    await openRepo(app, fx.work)
    await expect(toolbar).toContainText('main')

    // Create from the empty-filter row.
    await open()
    await menu.getByLabel('Filter branches').fill('feature')
    await menu.getByRole('button', { name: "Create branch 'feature'" }).click()
    await win.getByRole('dialog', { name: 'New branch' }).getByRole('button', { name: 'Create branch' }).click()
    await expect(toolbar.getByRole('button', { name: 'Current branch feature' })).toBeVisible()
    expect(head()).toBe('feature')

    // Clean switch.
    await open()
    await menu.getByRole('row', { name: /^main/ }).click()
    await expect(toolbar.getByRole('button', { name: 'Current branch main' })).toBeVisible()

    // Conflicting dirty tree -> native dialog -> Stash & switch.
    writeFileSync(path.join(fx.work, 'README.md'), 'local edit\n')
    await stubMessageBox(app.app, 0)
    await open()
    await menu.getByRole('row', { name: /^other/ }).click()
    await expect(toolbar.getByRole('button', { name: 'Current branch other' })).toBeVisible()
    expect(head()).toBe('other')
    await expect(win.getByText('You have stashed changes')).toHaveCount(0)
    await open()
    await menu.getByRole('row', { name: /^main/ }).click()
    await expect(win.getByText('You have stashed changes on main')).toBeVisible()
    await win.getByRole('button', { name: 'Restore' }).click()
    await expect(win.getByText('You have stashed changes on main')).toHaveCount(0)
    expect(readFileSync(path.join(fx.work, 'README.md'), 'utf8')).toBe('local edit\n')

    // Delete: current has no delete; non-current asks, then is gone.
    await open()
    await expect(menu.getByRole('button', { name: 'Delete main' })).toHaveCount(0)
    await stubMessageBox(app.app, 0)
    await menu.getByRole('button', { name: 'Delete feature' }).click()
    await expect.poll(() => fx.git(['branch', '--list', 'feature'])).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('New branch from a selected local or remote branch starts there, not at HEAD', async () => {
  const fx = createRepoFixture()
  const pushed = fx.git(['rev-parse', 'HEAD'])
  fx.git(['branch', 'other'])
  fx.commitFile('a.txt', 'a\n') // main is now ahead of origin/main and other
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const menu = win.getByRole('dialog', { name: 'Branches' })
  const dialog = win.getByRole('dialog', { name: 'New branch' })
  try {
    await openRepo(app, fx.work)
    await toolbar.getByRole('button', { name: /^Current branch/ }).click()
    await menu.getByRole('button', { name: 'Remote branches (1)' }).click()
    await menu.getByRole('grid', { name: 'Remote branches' }).getByRole('button', { name: 'New branch from origin/main' }).click()
    await expect(dialog).toContainText('From origin/main')
    await dialog.getByLabel('Name').fill('from-remote')
    await dialog.getByRole('button', { name: 'Create branch' }).click()
    await expect(toolbar.getByRole('button', { name: 'Current branch from-remote' })).toBeVisible()
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(pushed)

    await toolbar.getByRole('button', { name: /^Current branch/ }).click()
    await menu.getByRole('button', { name: 'New branch from main' }).click()
    await dialog.getByLabel('Name').fill('from-main')
    await dialog.getByRole('button', { name: 'Create branch' }).click()
    await expect(toolbar.getByRole('button', { name: 'Current branch from-main' })).toBeVisible()
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(fx.git(['rev-parse', 'main']))
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Stashes tab: list, show diff, apply, pop, drop with confirm', async () => {
  const fx = createRepoFixture()
  writeFileSync(path.join(fx.work, 'README.md'), 'one\n')
  fx.git(['stash', 'push', '-q', '-m', 'first'])
  writeFileSync(path.join(fx.work, 'README.md'), 'two\n')
  fx.git(['stash', 'push', '-q', '-m', 'second'])
  const app = await launchApp(fx.env)
  const { win } = app
  const list = win.getByRole('grid', { name: 'Stashes' })
  const readme = () => readFileSync(path.join(fx.work, 'README.md'), 'utf8')
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Stashes' }).click()
    await expect(list.getByRole('row')).toHaveCount(2)
    await list.getByRole('row', { name: /first/ }).click()
    await expect(win.getByLabel('Commit detail').getByRole('listbox', { name: 'Changed files' })).toContainText('README.md')
    await expect(win.getByLabel('Commit diff')).toContainText('one')

    await win.getByRole('button', { name: 'Apply' }).click()
    await expect.poll(readme).toBe('one\n')
    fx.git(['checkout', '-q', '--', 'README.md'])
    await win.getByRole('button', { name: 'Pop' }).click()
    await expect(list.getByRole('row')).toHaveCount(1)
    expect(readme()).toBe('one\n')

    // Drop asks first: Cancel keeps it, Drop removes it.
    await stubMessageBox(app.app, 1)
    await win.getByRole('button', { name: 'Drop…' }).click()
    await expect(list.getByRole('row')).toHaveCount(1)
    await stubMessageBox(app.app, 0)
    await win.getByRole('button', { name: 'Drop…' }).click()
    await expect(win.getByText('No stashes')).toBeVisible()
    expect(fx.git(['stash', 'list'])).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Stashes tab: conflicting pop shows the conflict banner without Continue/Abort, Pop disabled until resolved', async () => {
  const fx = createRepoFixture()
  writeFileSync(path.join(fx.work, 'README.md'), 'stashed\n')
  fx.git(['stash', 'push', '-q'])
  fx.commitFile('README.md', 'committed\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const banner = win.getByRole('status', { name: 'Conflicts' })
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Stashes' }).click()
    await win.getByRole('button', { name: 'Pop' }).click()
    await expect(banner).toContainText('README.md')
    await expect(banner.getByRole('button', { name: /Continue|Abort/ })).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Pop' })).toBeDisabled()
    await expect(win.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await banner.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(banner).toBeHidden()
    await expect(win.getByRole('button', { name: 'Pop' })).toBeEnabled()
    expect(fx.git(['stash', 'list'])).not.toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
