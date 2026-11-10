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

test('stage/unstage single lines of a hunk', async () => {
  const fx = createRepoFixture()
  fx.commitFile('f.txt', 'a\nb\nc\n')
  writeFileSync(path.join(fx.work, 'f.txt'), 'a\nB\nC\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'f.txt' }).click()
    const unstaged = win.getByRole('region', { name: 'Unstaged diff' })
    await toggle(unstaged.getByRole('checkbox', { name: 'Removed line 2' }))
    await toggle(unstaged.getByRole('checkbox', { name: 'Added line 2' }))
    await unstaged.getByRole('button', { name: 'Stage lines' }).click()
    const staged = win.getByRole('region', { name: 'Staged diff', exact: true })
    await expect(staged).toContainText('B')
    expect(fx.git(['show', ':f.txt'])).toBe('a\nB\nc')

    await toggle(staged.getByRole('checkbox', { name: 'Removed line 2' }))
    await toggle(staged.getByRole('checkbox', { name: 'Added line 2' }))
    await staged.getByRole('button', { name: 'Unstage lines' }).click()
    await expect(staged).toHaveCount(0)
    expect(fx.git(['diff', '--cached', '--name-only'])).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('changed-files filter (Mod+F): narrows the list; select-all stages only the shown files', async () => {
  const fx = createRepoFixture()
  for (const f of ['alpha.txt', 'Alpine.md', 'beta.txt']) writeFileSync(path.join(fx.work, f), 'x\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const cached = () => fx.git(['diff', '--cached', '--name-only'])
  try {
    await openRepo(app, fx.work)
    const list = win.getByRole('grid', { name: 'Changed files' })
    await expect(list.getByRole('row')).toHaveCount(3)
    await list.getByRole('row', { name: 'beta.txt' }).click()
    await win.keyboard.press('ControlOrMeta+f')
    const filter = win.getByRole('searchbox', { name: 'Filter changed files' })
    await expect(filter).toBeFocused()
    await win.keyboard.type('alp')
    await expect(list.getByRole('row')).toHaveText([/Alpine.md/, /alpha.txt/])
    await expect(win.getByText('2 of 3 changed files')).toBeVisible()
    await toggle(win.getByRole('checkbox', { name: 'Stage all shown' }))
    await expect(win.getByRole('checkbox', { name: 'Stage all shown' })).toBeChecked()
    expect(cached()).toBe('Alpine.md\nalpha.txt')
    await filter.press('Escape')
    await expect(list.getByRole('row')).toHaveCount(3)
    await expect(win.getByRole('checkbox', { name: 'Stage all' })).not.toBeChecked()
  } finally {
    await app.close()
    fx.cleanup()
  }
})
