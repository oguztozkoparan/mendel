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

test('Checkout locally fetches refs/changes/01/101/2 onto change/101-ps2; Rebase locally after a server conflict', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  const sha = fx.commitFile('feature.txt', 'x\n', 'Add feature X')
  fx.git(['push', '-q', 'origin', 'HEAD:refs/changes/01/101/2'])
  fx.git(['reset', '-q', '--hard', 'origin/main'])
  mock.changes[0].rebaseConflict = true
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()

  await win.getByRole('button', { name: 'Checkout locally' }).click()
  await expect(win.getByRole('status').filter({ hasText: 'Checked out #101 PS2 on change/101-ps2' })).toBeVisible()
  expect(fx.git(['branch', '--show-current'])).toBe('change/101-ps2')
  expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)

  await win.getByRole('button', { name: 'Rebase', exact: true }).click()
  await win.getByRole('button', { name: 'Rebase locally' }).click()
  await expect(win.getByRole('status').filter({ hasText: 'Rebased locally' })).toBeVisible()
  expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha) // already on top of origin/main
})
