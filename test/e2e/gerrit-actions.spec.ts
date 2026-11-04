import { expect, test } from '@playwright/test'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { connectGerrit, launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

const open = async (name: RegExp) => {
  await g!.win.getByRole('option', { name }).click()
  await expect(g!.win.getByRole('heading', { level: 2 }).first()).toBeVisible()
}

test('Submit / Abandon / Rebase shown only when listed in actions', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await open(/Add feature X/)
  for (const name of ['Submit…', 'Rebase', 'Abandon…']) await expect(win.getByRole('button', { name })).toBeVisible()

  await win.getByText('This project only').click()
  await open(/Fix crash in parser/) // incoming change without actions
  await expect(win.getByRole('heading', { name: 'Fix crash in parser' })).toBeVisible()
  for (const name of ['Submit…', 'Rebase', 'Abandon…']) await expect(win.getByRole('button', { name })).toHaveCount(0)
})

test('Submit → confirm → POST submit, detail shows Merged and a pull hint', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await open(/Add feature X/)
  await win.getByRole('button', { name: 'Submit…' }).click()
  await win.getByRole('dialog', { name: 'Submit #101?' }).getByRole('button', { name: 'Submit' }).click()
  await expect(win.getByRole('status')).toHaveText('Change merged. Pull to update your local branch.')
  expect(mock.find('POST', '/a/changes/101/submit')).toHaveLength(1)
  await expect(win.getByLabel('Status')).toHaveText('Merged')
  await expect(win.getByRole('button', { name: 'Submit…' })).toHaveCount(0)
})

test('Abandon with message, then Rebase success and conflict', async () => {
  mock.changes[0].rebaseConflict = true
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await open(/Add feature X/)

  await win.getByRole('button', { name: 'Rebase' }).click()
  await expect(win.getByRole('alert')).toHaveText('Gerrit could not rebase this change because of conflicts. Rebase it locally instead.')
  mock.changes[0].rebaseConflict = false
  await win.getByRole('button', { name: 'Rebase' }).click()
  await expect(win.getByRole('status')).toHaveText('Rebased on the server.')
  expect(mock.find('POST', '/a/changes/101/rebase')).toHaveLength(2)

  await win.getByRole('button', { name: 'Abandon…' }).click()
  const dialog = win.getByRole('dialog', { name: 'Abandon #101?' })
  await dialog.getByLabel('Message (optional)').fill('Not needed')
  await dialog.getByRole('button', { name: 'Abandon' }).click()
  await expect(win.getByLabel('Status')).toHaveText('Abandoned')
  expect(JSON.parse(mock.find('POST', '/a/changes/101/abandon')[0].body)).toEqual({ message: 'Not needed' })
  await expect(win.getByRole('listbox', { name: 'Reviews' }).getByRole('group', { name: 'Recently closed' })).toContainText('Add feature X')
})
