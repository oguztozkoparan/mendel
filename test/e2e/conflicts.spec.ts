import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

test('pull conflict: banner lists files; abort restores HEAD; mark resolved + continue completes', async () => {
  const fx = createRepoFixture()
  const other = path.join(fx.dir, 'other')
  execFileSync('git', ['clone', '-q', fx.remote, other], { env: fx.env })
  writeFileSync(path.join(other, 'README.md'), 'theirs\n')
  for (const a of [['commit', '-qam', 'theirs'], ['push', '-q']]) execFileSync('git', a, { cwd: other, env: fx.env })
  const before = fx.commitFile('README.md', 'ours\n')
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const banner = win.getByRole('status', { name: 'Conflicts' })
  try {
    await openRepo(app, fx.work)
    await toolbar.getByRole('button', { name: 'Sync options' }).click()
    await win.getByRole('menuitem', { name: 'Fetch' }).click()
    await toolbar.getByRole('button', { name: 'Pull ↓1 ↑1' }).click()
    await expect(banner).toContainText('Merge in progress')
    await expect(banner).toContainText('README.md')
    await expect(banner.getByRole('button', { name: 'Continue merge' })).toBeDisabled()

    await stubMessageBox(app.app, 0)
    await banner.getByRole('button', { name: 'Abort…' }).click()
    await expect(banner).toHaveCount(0)
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(before)

    await toolbar.getByRole('button', { name: 'Pull ↓1 ↑1' }).click()
    await expect(banner).toContainText('README.md')
    writeFileSync(path.join(fx.work, 'README.md'), 'resolved\n')
    await banner.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(banner).toContainText('All conflicts resolved')
    await banner.getByRole('button', { name: 'Continue merge' }).click()
    await expect(banner).toHaveCount(0)
    expect(fx.git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ')).toHaveLength(3)
    await expect(toolbar.getByRole('button', { name: 'Push ↑2' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
  }
})
