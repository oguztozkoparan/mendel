import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('Show whitespace (persisted) and the 72-column description ruler', async () => {
  const fx = createRepoFixture()
  writeFileSync(path.join(fx.work, 'README.md'), 'a b\tc\n')
  const userData = path.join(fx.dir, 'userData')
  let l = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  try {
    await openRepo(l, fx.work)
    const diff = l.win.getByRole('region', { name: 'Unstaged diff' })
    await expect(diff).toContainText('a b')
    await l.win.getByText('Show whitespace').click()
    await expect(diff).toContainText('a·b→')

    const description = l.win.getByRole('textbox', { name: 'Description' })
    await expect(description).not.toHaveAttribute('data-ruler')
    await l.win.getByRole('button', { name: 'Settings' }).click()
    const dialog = l.win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Commit' }).click()
    await dialog.getByText('Show 72-column ruler in description').click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(description).toHaveAttribute('data-ruler', 'true')

    await l.close()
    l = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await l.win.getByRole('tab', { name: 'Changes' }).waitFor()
    await expect(l.win.getByRole('checkbox', { name: 'Show whitespace' })).toBeChecked()
    await expect(l.win.getByRole('region', { name: 'Unstaged diff' })).toContainText('a·b→')
  } finally {
    await l.close()
    fx.cleanup()
  }
})
