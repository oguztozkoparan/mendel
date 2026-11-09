import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

test('Settings → Gerrit: provider None and back to Auto, connect, reviews refresh interval', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  const reviews = win.getByRole('tab', { name: 'Reviews' })
  await expect(reviews).toBeVisible()
  const settings = win.getByRole('dialog', { name: 'Settings' })
  const openGerrit = async () => {
    await win.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('tab', { name: 'Gerrit' }).click()
  }
  const setProvider = async (value: string) => {
    await settings.getByRole('button', { name: 'Repository provider…' }).click()
    const d = win.getByRole('dialog', { name: 'Repository provider' })
    await d.getByLabel('Provider').selectOption(value)
    await d.getByRole('button', { name: 'Save' }).click()
    await expect(d).toHaveCount(0)
  }

  await openGerrit()
  await expect(settings).toContainText(`Gerrit at ${mock.url}`)
  await expect(settings).toContainText('Not connected')
  await setProvider('none')
  await expect(settings).toContainText('No provider · provider setting: none')
  await expect(reviews).toHaveCount(0)
  await setProvider('auto')
  await expect(settings).toContainText(`Gerrit at ${mock.url}`)
  await expect(reviews).toBeVisible()

  await settings.getByRole('button', { name: 'Connect…' }).click()
  const connect = win.getByRole('dialog', { name: /Connect to Gerrit/ })
  await connect.getByLabel('HTTP password / token').fill(mock.password)
  await connect.getByRole('button', { name: 'Test & save' }).click()
  await expect(connect.getByRole('status')).toContainText('Connected as')
  await connect.getByRole('button', { name: 'Close' }).click()
  await expect(settings).toContainText('Connected as test')

  await settings.getByText('Every 15 min', { exact: true }).click()
  await expect.poll(() => JSON.parse(readFileSync(path.join(g!.userData, 'settings.json'), 'utf8')).reviewsRefreshMinutes).toBe(15)
  await settings.getByText('Review notifications').click()
  await expect.poll(() => JSON.parse(readFileSync(path.join(g!.userData, 'settings.json'), 'utf8')).reviewNotifications).toBe(false)
  await settings.getByRole('button', { name: 'Done' }).click()
  await expect(settings).toHaveCount(0)
})
