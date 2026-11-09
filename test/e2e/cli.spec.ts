import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp } from './launch'

test('`mendel <dir>` opens the repo on launch, and a second launch hands its dir to the running app', async () => {
  const fx = createRepoFixture()
  const other = createRepoFixture()
  mkdirSync(path.join(fx.work, 'sub'))
  const env = { ...fx.env, MENDEL_E2E_USERDATA: path.join(fx.dir, 'userData') }
  const { app, win, close } = await launchApp(env, [path.join(fx.work, 'sub')])
  try {
    await expect(win.getByLabel('Toolbar')).toContainText('work')
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    const second = path.join(other.dir, 'second')
    other.git(['clone', '-q', other.remote, second], other.dir)
    const run = spawnSync(await app.evaluate(() => process.execPath), ['out/main/index.js', second], { env: { ...process.env, ...env }, timeout: 30_000 })
    expect(run.status).toBe(0)
    await expect(win.getByLabel('Toolbar')).toContainText('second')
  } finally {
    await close()
    fx.cleanup()
    other.cleanup()
  }
})
