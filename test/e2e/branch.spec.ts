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
