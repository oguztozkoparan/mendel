import { expect, test } from '@playwright/test'
import { launchApp } from './launch'

test('window opens hardened with welcome screen and typed api', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
    await expect(win.locator('html')).toHaveAttribute('data-platform', process.platform)
    expect(win.url()).toBe('app://gitdock/index.html')
    expect(await win.evaluate(() => ['require', 'process'].map((k) => typeof (window as never as Record<string, unknown>)[k]))).toEqual(['undefined', 'undefined'])
    expect(await win.evaluate(() => Object.keys(window.gitdock).sort())).toEqual(['app:info', 'on'])
    // Navigation away from the app origin is blocked.
    await win.evaluate(() => (location.href = 'https://example.com/'))
    await win.waitForTimeout(300)
    expect(win.url()).toBe('app://gitdock/index.html')
  } finally {
    await close()
  }
})
