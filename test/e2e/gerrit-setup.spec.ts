import { expect, test } from '@playwright/test'
import { createRepoFixture } from '../fixtures/repo'
import { startGerritMock } from '../fixtures/gerrit-mock'
import { launchApp, openRepo } from './launch'

test('port 29418 without reachable REST → "Set Gerrit URL"; override fixes it; "None" removes the tab', async () => {
  const mock = await startGerritMock()
  const fx = createRepoFixture()
  fx.git(['remote', 'set-url', 'origin', 'ssh://u@gerrit.invalid:29418/p/q'])
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Reviews' }).click()
    const card = win.getByRole('region', { name: 'Set Gerrit URL' })
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: 'Set Gerrit URL…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Repository provider' })
    await dialog.getByLabel('Gerrit URL').fill('https://user:pw@example.com')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toContainText('no credentials')
    await dialog.getByLabel('Gerrit URL').fill(mock.url)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toBeHidden()
    await expect(win.getByRole('region', { name: 'Connect to Gerrit' })).toContainText(mock.url)

    await win.getByRole('button', { name: 'Gerrit settings…' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Repository provider…' }).click()
    await dialog.getByLabel('Provider').selectOption('none')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(settings).toContainText('No provider')
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(win.getByRole('tab', { name: 'Reviews' })).toBeHidden()
    await expect(win.getByRole('tab', { name: 'Changes' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
    await mock.close()
  }
})
