import { expect, test } from '@playwright/test'
import { invoke } from '../../src/shared/ipc'
import { launchApp } from './launch'

test('window opens hardened with welcome screen and typed api', async () => {
  const { win, close } = await launchApp()
  try {
    await expect(win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
    await expect(win.locator('html')).toHaveAttribute('data-platform', process.platform)
    expect(win.url()).toBe('app://mendel/index.html')
    await expect(win.getByText(/^git \d+\.\d+.* found at .+/)).toBeVisible()
    expect(await win.evaluate(() => ['require', 'process'].map((k) => typeof (window as never as Record<string, unknown>)[k]))).toEqual(['undefined', 'undefined'])
    expect(await win.evaluate(() => Object.keys(window.mendel).sort())).toEqual([...Object.keys(invoke), 'on'].sort())
    // Navigation away from the app origin is blocked.
    await win.evaluate(() => (location.href = 'https://example.com/'))
    await win.waitForTimeout(300)
    expect(win.url()).toBe('app://mendel/index.html')
  } finally {
    await close()
  }
})

test('missing git shows blocking card with recheck', async () => {
  const { win, close } = await launchApp({ PATH: '/nonexistent' })
  try {
    await expect(win.getByRole('alert')).toContainText('Git not found')
    await expect(win.getByRole('button', { name: 'Recheck' })).toBeVisible()
  } finally {
    await close()
  }
})
