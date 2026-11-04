import { expect, test } from '@playwright/test'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('git failure → friendly text by kind, Show details (redacted stderr), Copy, Retry', async () => {
  const fx = createRepoFixture()
  fx.git(['remote', 'set-url', 'origin', 'https://bob:s3cret@127.0.0.1:9/x.git']) // port 9: connection refused
  const l = await launchApp(fx.env)
  const { app, win } = l
  try {
    await openRepo(l, fx.work)
    await win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' }).click()
    const banner = win.getByRole('alert').filter({ hasText: 'Could not reach the remote' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'Show details' }).click()
    await expect(banner.locator('pre')).toContainText('127.0.0.1')
    await expect(banner).not.toContainText('s3cret')
    await banner.getByRole('button', { name: 'Copy' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Could not reach the remote')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).not.toContain('s3cret')

    // Retry runs the same op again: with the remote fixed it succeeds and the banner is gone.
    fx.git(['remote', 'set-url', 'origin', fx.remote])
    await banner.getByRole('button', { name: 'Retry' }).click()
    await expect(win.getByRole('alert')).toHaveCount(0)
    await expect(win.getByLabel('Toolbar')).toContainText('Fetched just now')
  } finally {
    await l.close()
    fx.cleanup()
  }
})
