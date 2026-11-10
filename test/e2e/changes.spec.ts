import { expect, test } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('watcher lists M/A/D/R changes and selecting a file shows its diff', async () => {
  const fx = createRepoFixture()
  fx.commitFile('gone.txt', 'bye\n')
  fx.commitFile('old.txt', 'rename me\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    const list = win.getByRole('grid', { name: 'Changed files' })
    await expect(win.getByText('No local changes')).toBeVisible()

    writeFileSync(path.join(fx.work, 'README.md'), '# fixture\nnew line\n')
    writeFileSync(path.join(fx.work, 'added.txt'), 'added\n')
    rmSync(path.join(fx.work, 'gone.txt'))
    fx.git(['mv', 'old.txt', 'renamed.txt'])
    writeFileSync(path.join(fx.work, 'img.bin'), Buffer.from([0, 1, 2, 0, 255]))

    const row = (name: string) => list.getByRole('row', { name })
    const opts = { timeout: 2000 }
    await expect(row('README.md')).toContainText('M', opts)
    await expect(row('added.txt')).toContainText('A', opts)
    await expect(row('gone.txt')).toContainText('D', opts)
    await expect(row('renamed.txt')).toContainText('R', opts)

    await row('README.md').click()
    await expect(win.getByRole('region', { name: 'Unstaged diff' })).toContainText('new line')
    await row('img.bin').click()
    await expect(win.getByText('Binary file changed')).toBeVisible()
    await row('renamed.txt').click()
    await expect(win.getByRole('heading', { name: 'old.txt → renamed.txt' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('a .ts diff is syntax-highlighted', async () => {
  const fx = createRepoFixture()
  fx.commitFile('a.ts', 'let a = 1\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    writeFileSync(path.join(fx.work, 'a.ts'), 'export const a = 2\n')
    await win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'a.ts' }).click({ timeout: 2000 })
    await expect(win.getByRole('region', { name: 'Unstaged diff' }).locator('.diff-code .token.keyword')).toHaveText(['let', 'export', 'const'])
  } finally {
    await app.close()
    fx.cleanup()
  }
})
