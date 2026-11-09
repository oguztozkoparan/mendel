import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('history: revert a commit; cherry-pick from another branch conflicts into the banner and continues', async () => {
  const fx = createRepoFixture()
  fx.git(['switch', '-q', '-c', 'other'])
  fx.commitFile('README.md', 'theirs\n', 'theirs')
  fx.git(['switch', '-q', 'main'])
  fx.commitFile('README.md', 'ours\n', 'ours')
  fx.commitFile('b.txt', 'bee\n', 'Add b')
  const app = await launchApp(fx.env)
  const { win } = app
  const detail = win.getByLabel('Commit detail')
  const banner = win.getByRole('status', { name: 'Conflicts' })
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    await expect(detail.getByRole('heading', { name: 'Add b' })).toBeVisible()
    await detail.getByRole('button', { name: 'Revert commit' }).click()
    await expect(win.getByRole('grid', { name: 'Commits' }).getByRole('row').first()).toContainText('Revert "Add b"')
    expect(fx.git(['ls-files'])).not.toContain('b.txt')

    await win.getByLabel('History branch').selectOption('other')
    await expect(detail.getByRole('heading', { name: 'theirs' })).toBeVisible()
    await detail.getByRole('button', { name: 'Cherry-pick onto current branch' }).click()
    await expect(banner).toContainText('Cherry-pick in progress')
    await expect(banner).toContainText('README.md')
    writeFileSync(path.join(fx.work, 'README.md'), 'resolved\n')
    await banner.getByRole('button', { name: 'Mark resolved' }).click()
    await banner.getByRole('button', { name: 'Continue cherry-pick' }).click()
    await expect(banner).toHaveCount(0)
    expect(fx.git(['log', '--format=%s', '-1'])).toBe('theirs')
    expect(fx.git(['branch', '--show-current'])).toBe('main')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
