import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('window opens hardened with welcome screen and typed api', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'gitdock-e2e-'))
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, GITDOCK_E2E_USERDATA: userData } })
  try {
    const win = await app.firstWindow()
    await expect(win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
    await expect(win.locator('html')).toHaveAttribute('data-platform', process.platform)
    expect(win.url()).toBe('app://gitdock/index.html')
    expect(await win.evaluate(() => [typeof (window as never as Record<string, unknown>).require, typeof (window as never as Record<string, unknown>).process])).toEqual(['undefined', 'undefined'])
    expect(await win.evaluate(() => Object.keys(window.gitdock).sort())).toEqual(['app:info', 'on'])
    // Navigation away from the app origin is blocked.
    await win.evaluate(() => (location.href = 'https://example.com/'))
    await win.waitForTimeout(300)
    expect(win.url()).toBe('app://gitdock/index.html')
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
