import { expect, test, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

// react-aria hides the native input; click the visible box (its label) like a user does.
const toggle = (cb: Locator) => cb.locator('xpath=ancestor::label').click()
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)

test('stage/unstage files with checkboxes and single hunks', async () => {
  const fx = createRepoFixture()
  fx.commitFile('f.txt', LINES.join('\n') + '\n')
  writeFileSync(path.join(fx.work, 'f.txt'), LINES.map((l, i) => (i === 1 ? 'first change' : i === 25 ? 'second change' : l)).join('\n') + '\n')
  writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const cached = () => fx.git(['diff', '--cached', '--name-only'])
  try {
    await openRepo(app, fx.work)
    const list = win.getByRole('grid', { name: 'Changed files' })
    const readme = list.getByRole('row', { name: 'README.md' }).getByRole('checkbox', { name: 'Staged' })
    await toggle(readme)
    await expect(readme).toBeChecked()
    expect(cached()).toBe('README.md')
    await toggle(readme)
    await expect(readme).not.toBeChecked()
    expect(cached()).toBe('')

    await toggle(win.getByRole('checkbox', { name: 'Stage all' }))
    await expect(win.getByRole('checkbox', { name: 'Stage all' })).toBeChecked()
    expect(cached()).toBe('README.md\nf.txt')
    await toggle(win.getByRole('checkbox', { name: 'Stage all' }))
    await expect(win.getByRole('checkbox', { name: 'Stage all' })).not.toBeChecked()

    await list.getByRole('row', { name: 'f.txt' }).click()
    await win.getByRole('region', { name: 'Unstaged diff' }).getByRole('button', { name: 'Stage hunk' }).first().click()
    const staged = win.getByRole('region', { name: 'Staged diff', exact: true })
    await expect(staged).toContainText('first change')
    await expect(staged).not.toContainText('second change')
    expect(fx.git(['diff', '--cached'])).not.toContain('second change')
    await staged.getByRole('button', { name: 'Unstage hunk' }).click()
    await expect(staged).toHaveCount(0)
    expect(cached()).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
