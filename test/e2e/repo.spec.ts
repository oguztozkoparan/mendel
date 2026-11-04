import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, stubMessageBox, stubOpenDialog } from './launch'

test('open a repo subfolder opens the top level, adds to recents and reopens on relaunch', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  mkdirSync(path.join(fx.work, 'sub'))
  let { app, win, close } = await launchApp({ ...fx.env, GITDOCK_E2E_USERDATA: userData })
  try {
    await stubOpenDialog(app, path.join(fx.work, 'sub'))
    await win.getByRole('button', { name: 'Open local repository…' }).click()
    const toolbar = win.getByLabel('Toolbar')
    await expect(toolbar).toContainText('work')
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    await toolbar.getByRole('button').first().click()
    await expect(win.getByRole('dialog', { name: 'Repositories' }).getByRole('row')).toHaveText([/work.*\/work/])
    await close()
    ;({ app, win, close } = await launchApp({ ...fx.env, GITDOCK_E2E_USERDATA: userData }))
    await expect(win.getByLabel('Toolbar')).toContainText('work')
  } finally {
    await close()
    fx.cleanup()
  }
})

test('non-repo folder shows "Not a git repository" and leaves recents unchanged', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitdock-norepo-'))
  const { app, win, close } = await launchApp()
  try {
    await stubOpenDialog(app, dir)
    await win.getByRole('button', { name: 'Open local repository…' }).click()
    await expect(win.getByRole('alert')).toContainText('Not a git repository')
    await expect(win.getByRole('grid', { name: 'Recent repositories' })).toHaveCount(0)
  } finally {
    await close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recent entry with deleted path is greyed with Locate and Remove', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  const other = path.join(fx.dir, 'other')
  fx.git(['clone', '-q', fx.remote, other], fx.dir)
  let { app, win, close } = await launchApp({ ...fx.env, GITDOCK_E2E_USERDATA: userData })
  try {
    await stubOpenDialog(app, other)
    await win.getByRole('button', { name: 'Open local repository…' }).click()
    await expect(win.getByLabel('Toolbar')).toContainText('other')
    await close()
    rmSync(other, { recursive: true, force: true })
    ;({ app, win, close } = await launchApp({ ...fx.env, GITDOCK_E2E_USERDATA: userData }))
    const row = win.getByRole('row', { name: 'other' })
    await expect(row).toContainText('Missing:')
    // Locate re-points the entry to an existing clone.
    await stubOpenDialog(app, fx.work)
    await row.getByRole('button', { name: 'Locate…' }).click()
    await expect(win.getByLabel('Toolbar')).toContainText('work')
    await win.getByLabel('Toolbar').getByRole('button').first().click()
    const rows = win.getByRole('dialog', { name: 'Repositories' }).getByRole('row')
    await expect(rows).toHaveCount(1)
    await rows.first().getByRole('button', { name: 'Remove work from list' }).click()
    await expect(win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
  } finally {
    await close()
    fx.cleanup()
  }
})

test('dubious ownership: cancel keeps it closed, "Trust this folder" adds exactly it to safe.directory and opens it', async () => {
  const fx = createRepoFixture()
  const { app, win, close } = await launchApp({ ...fx.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' })
  try {
    await stubOpenDialog(app, fx.work)
    await stubMessageBox(app, 1)
    await win.getByRole('button', { name: 'Open local repository…' }).click()
    await expect(win.getByRole('alert')).toContainText('dubious ownership')
    await stubMessageBox(app, 0)
    await win.getByRole('button', { name: 'Open local repository…' }).click()
    await expect(win.getByLabel('Toolbar')).toContainText('work')
    expect(path.resolve(fx.git(['config', '--global', '--get-all', 'safe.directory']))).toBe(fx.work)
  } finally {
    await close()
    fx.cleanup()
  }
})
