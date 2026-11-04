import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, stubOpenDialog } from './launch'

test('clone from bare remote opens it on Changes; non-empty target errors', async () => {
  const fx = createRepoFixture()
  const parent = path.join(fx.dir, 'clones')
  mkdirSync(path.join(parent, 'taken'), { recursive: true })
  writeFileSync(path.join(parent, 'taken/file'), 'x')
  const { app, win, close } = await launchApp(fx.env)
  try {
    await stubOpenDialog(app, parent)
    await win.getByRole('button', { name: 'Clone repository…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Clone repository' })
    await dialog.getByRole('button', { name: 'Choose…' }).click()
    await expect(dialog).toContainText(parent)
    await dialog.getByLabel('Repository URL').fill(pathToFileURL(fx.remote).href)
    await expect(dialog.getByLabel('Folder name')).toHaveValue('remote')

    await dialog.getByLabel('Folder name').fill('taken')
    await dialog.getByRole('button', { name: 'Clone' }).click()
    await expect(dialog.getByRole('alert')).toContainText('not empty')

    await dialog.getByLabel('Folder name').fill('mine')
    await dialog.getByRole('button', { name: 'Clone' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(win.getByLabel('Toolbar')).toContainText('mine')
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    expect(fx.git(['log', '-1', '--format=%s'], path.join(parent, 'mine'))).toBe('initial commit')
  } finally {
    await close()
    fx.cleanup()
  }
})
