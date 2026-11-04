import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
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
