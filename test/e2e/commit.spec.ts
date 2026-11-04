import { expect, test } from '@playwright/test'
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('commit with summary and description, amend, and failing hook', async () => {
  const fx = createRepoFixture()
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    const box = win.getByRole('form', { name: 'Commit' })
    const button = box.getByRole('button', { name: 'Commit to main' })
    await expect(box).toContainText('Committing as Test User <test@example.com>')

    writeFileSync(path.join(fx.work, 'a.txt'), 'a\n')
    await box.getByLabel('Summary').fill('Add a')
    await expect(button).toBeDisabled() // nothing staged
    await win.getByRole('row', { name: 'a.txt' }).getByRole('checkbox').locator('xpath=ancestor::label').click()
    await expect(button).toBeEnabled()
    await box.getByLabel('Summary').fill('')
    await expect(button).toBeDisabled() // empty summary
    await box.getByLabel('Summary').fill('Add a')
    await box.getByLabel('Description').fill('Why we add a')
    await button.click()
    await expect(win.getByText('No local changes')).toBeVisible()
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('Add a\n\nWhy we add a')
    await expect(box.getByLabel('Summary')).toHaveValue('')

    const count = fx.git(['rev-list', '--count', 'HEAD'])
    await box.getByText('Amend last commit').click()
    await expect(box.getByLabel('Summary')).toHaveValue('Add a')
    await expect(box.getByLabel('Description')).toHaveValue('Why we add a')
    await box.getByLabel('Summary').fill('Add a (amended)')
    await box.getByLabel('Summary').press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(box.getByLabel('Summary')).toHaveValue('')
    expect(fx.git(['rev-list', '--count', 'HEAD'])).toBe(count)
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('Add a (amended)\n\nWhy we add a')

    const hook = path.join(fx.work, '.git/hooks/commit-msg')
    writeFileSync(hook, '#!/bin/sh\necho "hook rejected this" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    writeFileSync(path.join(fx.work, 'b.txt'), 'b\n')
    fx.git(['add', 'b.txt'])
    await expect(win.getByRole('row', { name: 'b.txt' })).toBeVisible()
    await box.getByLabel('Summary').fill('Add b')
    await box.getByRole('button', { name: 'Commit to main' }).click()
    await expect(box.getByRole('alert')).toContainText('hook rejected this')
    await expect(box.getByLabel('Summary')).toHaveValue('Add b')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
