import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)

test('discard file and hunk ask for confirmation; cancel changes nothing', async () => {
  const fx = createRepoFixture()
  fx.commitFile('f.txt', LINES.join('\n') + '\n')
  const changed = LINES.map((l, i) => (i === 1 ? 'first change' : i === 25 ? 'second change' : l)).join('\n') + '\n'
  writeFileSync(path.join(fx.work, 'f.txt'), changed)
  writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const read = (f: string) => readFileSync(path.join(fx.work, f), 'utf8')
  try {
    await openRepo(app, fx.work)
    const list = win.getByRole('grid', { name: 'Changed files' })

    await list.getByRole('row', { name: 'README.md' }).click()
    await stubMessageBox(app.app, 1) // Cancel
    await win.getByRole('button', { name: 'Discard file…' }).click()
    await win.waitForTimeout(300)
    expect(read('README.md')).toBe('changed\n')
    await stubMessageBox(app.app, 0) // Discard
    await win.getByRole('button', { name: 'Discard file…' }).click()
    await expect(list.getByRole('row', { name: 'README.md' })).toHaveCount(0)
    expect(read('README.md')).toBe('# fixture\n')

    await list.getByRole('row', { name: 'f.txt' }).click()
    await win.getByRole('button', { name: 'Discard hunk…' }).first().click()
    await expect(win.getByRole('region', { name: 'Unstaged diff' })).not.toContainText('first change')
    expect(read('f.txt')).not.toContain('first change')
    expect(read('f.txt')).toContain('second change')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('discard all: themed confirm, untracked kept unless ticked, backup stash with Undo, refused mid-merge', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.txt', 'a\n')
  writeFileSync(path.join(fx.work, 'a.txt'), 'changed\n')
  writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
  writeFileSync(path.join(fx.work, 'loose.txt'), 'l\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const read = (f: string) => readFileSync(path.join(fx.work, f), 'utf8')
  const list = win.getByRole('grid', { name: 'Changed files' })
  const dialog = win.getByRole('alertdialog', { name: 'Discard all changes?' })
  try {
    await openRepo(app, fx.work)
    await win.getByRole('button', { name: 'Discard all changes…' }).click()
    await expect(dialog).toContainText('2 files will be reset')
    // Cancel has focus: Enter cancels, nothing changes.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    expect(read('a.txt')).toBe('changed\n')

    // From the menu; Escape cancels too.
    await app.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('changes:discardAll')!.click())
    await expect(dialog).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Filtered: only the shown files.
    await win.getByRole('searchbox', { name: 'Filter changed files' }).fill('a.txt')
    await win.getByRole('button', { name: 'Discard 1 file shown…' }).click()
    await win.getByRole('alertdialog', { name: 'Discard 1 file shown?' }).getByRole('button', { name: 'Discard shown' }).click()
    await expect(win.getByRole('alert').filter({ hasText: 'Changes discarded' })).toBeVisible()
    expect(read('a.txt')).toBe('a\n')
    expect(read('README.md')).toBe('changed\n')
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => read('a.txt')).toBe('changed\n')
    await win.getByRole('searchbox', { name: 'Filter changed files' }).fill('')

    // All, untracked not ticked: loose.txt survives.
    await win.getByRole('button', { name: 'Discard all changes…' }).click()
    await expect(dialog.getByRole('checkbox', { name: /Also delete 1 file/ })).not.toBeChecked()
    await dialog.getByRole('button', { name: 'Discard all' }).click()
    await expect(list.getByRole('row')).toHaveCount(1)
    expect(read('README.md')).toBe('# fixture\n')
    expect(read('loose.txt')).toBe('l\n')

    // Ticked: untracked goes too.
    await win.getByRole('button', { name: 'Discard all changes…' }).click()
    await dialog.getByText(/Also delete 1 file/).click()
    await dialog.getByRole('button', { name: 'Discard all' }).click()
    await expect(win.getByText('No local changes')).toBeVisible()
    expect(existsSync(path.join(fx.work, 'loose.txt'))).toBe(false)

    await win.getByRole('tab', { name: 'Stashes' }).click()
    await expect(win.getByRole('grid', { name: 'Stashes' }).getByRole('row', { name: /Discarded changes/ })).toHaveCount(2)
    await win.getByRole('tab', { name: 'Changes' }).click()

    // Mid-merge: refused in the dialog, nothing touched.
    execFileSync('git', ['checkout', '-q', '-b', 'other'], { cwd: fx.work, env: fx.env })
    fx.commitFile('a.txt', 'theirs\n')
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: fx.work, env: fx.env })
    fx.commitFile('a.txt', 'ours\n')
    expect(() => execFileSync('git', ['merge', '-q', 'other'], { cwd: fx.work, env: fx.env, stdio: 'pipe' })).toThrow()
    await app.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('status:refresh')?.click())
    await win.getByRole('button', { name: 'Discard all changes…' }).click()
    await dialog.getByRole('button', { name: 'Discard all' }).click()
    await expect(dialog.getByRole('alert')).toContainText('A merge is in progress')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(fx.git(['status', '--porcelain'])).toBe('UU a.txt')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
