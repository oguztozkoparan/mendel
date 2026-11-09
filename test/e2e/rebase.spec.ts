import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, type LaunchedApp } from './launch'

function remoteCommit(fx: RepoFixture, name: string, content: string) {
  const other = path.join(fx.dir, 'other')
  execFileSync('git', ['clone', '-q', fx.remote, other], { env: fx.env })
  writeFileSync(path.join(other, name), content)
  for (const a of [['add', name], ['commit', '-qm', `remote ${name}`], ['push', '-q']]) execFileSync('git', a, { cwd: other, env: fx.env })
}

const rebase = async ({ win }: LaunchedApp) => {
  await win.getByLabel('Toolbar').getByRole('button', { name: 'Sync options' }).click()
  await win.getByRole('menuitem', { name: 'Rebase onto upstream' }).click()
}

test('rebase onto upstream: clean case rebases', async () => {
  const fx = createRepoFixture()
  remoteCommit(fx, 'r.txt', 'r\n')
  fx.commitFile('a.txt', 'a\n')
  const app = await launchApp(fx.env)
  try {
    await openRepo(app, fx.work)
    await rebase(app)
    await expect(app.win.getByLabel('Toolbar').getByRole('button', { name: 'Push ↑1' })).toBeVisible()
    expect(fx.git(['log', '--format=%s', '-2'])).toBe('add a.txt\nremote r.txt')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('rebase onto upstream: conflict case shows banner', async () => {
  const fx = createRepoFixture()
  remoteCommit(fx, 'README.md', 'theirs\n')
  fx.commitFile('README.md', 'ours\n')
  const app = await launchApp(fx.env)
  try {
    await openRepo(app, fx.work)
    await rebase(app)
    const banner = app.win.getByRole('status', { name: 'Conflicts' })
    await expect(banner).toContainText('Rebase in progress')
    await expect(banner).toContainText('README.md')
    // One primary on screen: Continue in the banner; Commit steps down to secondary and continues the rebase.
    await expect(banner.getByRole('button', { name: 'Continue rebase' })).toHaveClass(/\bprimary\b/)
    await expect(banner.getByRole('button', { name: 'Abort…' })).toHaveClass(/\bghost\b/)
    const box = app.win.getByRole('form', { name: 'Commit' })
    const commit = box.getByRole('button', { name: 'Commit and continue rebase' })
    await expect(commit).not.toHaveClass(/\bprimary\b/)
    writeFileSync(path.join(fx.work, 'README.md'), 'both\n')
    await banner.getByRole('button', { name: 'Mark resolved' }).click()
    await box.getByRole('textbox', { name: 'Summary' }).fill('ours, resolved')
    await commit.click()
    await expect(banner).toBeHidden()
    await expect(box.getByRole('button', { name: 'Commit to main' })).toHaveClass(/\bprimary\b/)
    expect(fx.git(['log', '--format=%s', '-2'])).toBe('ours, resolved\nremote README.md')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
