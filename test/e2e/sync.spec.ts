import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { startAuthRemote } from '../fixtures/auth-remote'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

/** Commit + push from a second clone so origin gets ahead of work/. */
function pushFromOther(fx: RepoFixture, name: string) {
  const other = path.join(fx.dir, 'other')
  execFileSync('git', ['clone', '-q', fx.remote, other], { cwd: fx.dir, env: fx.env, stdio: 'pipe' })
  writeFileSync(path.join(other, name), 'x\n')
  for (const args of [['add', name], ['commit', '-q', '-m', `remote ${name}`], ['push', '-q']]) execFileSync('git', args, { cwd: other, env: fx.env, stdio: 'pipe' })
}

test('push, fetch + pull, rejected push banner, publish', async () => {
  const fx = createRepoFixture()
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  try {
    await openRepo(app, fx.work)
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()

    const sha = fx.commitFile('a.txt', 'a\n')
    await toolbar.getByRole('button', { name: 'Push ↑1' }).click()
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()
    expect(fx.git(['rev-parse', 'main'], fx.remote)).toBe(sha)

    pushFromOther(fx, 'r.txt')
    await toolbar.getByRole('button', { name: 'Fetch origin' }).click()
    await toolbar.getByRole('button', { name: 'Pull ↓1' }).click()
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()
    expect(fx.git(['log', '-1', '--format=%s'])).toBe('remote r.txt')

    // Diverged without fetching: push is rejected -> banner with Pull.
    execFileSync('git', ['pull', '-q'], { cwd: path.join(fx.dir, 'other'), env: fx.env })
    writeFileSync(path.join(fx.dir, 'other', 'r2.txt'), 'x\n')
    execFileSync('git', ['add', 'r2.txt'], { cwd: path.join(fx.dir, 'other'), env: fx.env })
    execFileSync('git', ['commit', '-q', '-m', 'r2'], { cwd: path.join(fx.dir, 'other'), env: fx.env })
    execFileSync('git', ['push', '-q'], { cwd: path.join(fx.dir, 'other'), env: fx.env })
    fx.commitFile('b.txt', 'b\n')
    await toolbar.getByRole('button', { name: 'Push ↑1' }).click()
    const banner = win.getByRole('alert').filter({ hasText: 'Remote has new commits' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Pull' }).click()
    await expect(toolbar.getByRole('button', { name: 'Push ↑2' })).toBeVisible()

    fx.git(['switch', '-q', '-c', 'feature'])
    await toolbar.getByRole('button', { name: 'Publish branch' }).click()
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()
    expect(fx.git(['rev-parse', '--abbrev-ref', 'feature@{u}'])).toBe('origin/feature')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('auth prompt names the op and repo, and closes when that op is cancelled (S5, R15)', async () => {
  test.skip(process.platform === 'win32', 'askpass bridge is off on Windows')
  const fx = createRepoFixture()
  const remote = await startAuthRemote()
  fx.git(['remote', 'set-url', 'origin', `${remote.url}/repo.git`])
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' }).click()
    const dialog = win.getByRole('dialog', { name: 'Authentication required' })
    await expect(dialog).toContainText(`git fetch in ${fx.work}`)
    // The modal covers the toolbar's Cancel; call the same IPC it uses.
    await win.evaluate(() => (window as unknown as { mendel: Record<string, () => Promise<void>> }).mendel['sync:cancel']())
    await expect(dialog).toHaveCount(0)
    await expect(win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' })).toBeVisible()
  } finally {
    await app.close()
    await remote.close()
    fx.cleanup()
  }
})

test('cancelling an auth prompt during fetch ends the op with a message', async () => {
  test.skip(process.platform === 'win32', 'askpass bridge is off on Windows')
  const fx = createRepoFixture()
  const remote = await startAuthRemote()
  fx.git(['remote', 'set-url', 'origin', `${remote.url}/repo.git`])
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' }).click()
    await win.getByRole('dialog', { name: 'Authentication required' }).getByRole('button', { name: 'Cancel' }).click()
    const t = Date.now()
    await expect(win.getByRole('alert').first()).toBeVisible()
    expect(Date.now() - t).toBeLessThan(5000)
    await expect(win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' })).toBeVisible()
  } finally {
    await app.close()
    await remote.close()
    fx.cleanup()
  }
})
