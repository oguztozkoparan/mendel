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

test('change detail: header, labels, files with Commit Message first, side-by-side diff, patch sets', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()

  await expect(win.getByRole('heading', { name: 'Add feature X' })).toBeVisible()
  await expect(win.getByLabel('Status')).toHaveText('Open')
  const labels = win.getByRole('region', { name: 'Labels' })
  await expect(labels).toContainText('Code-ReviewAda Reviewer −1')
  await expect(labels).toContainText('VerifiedAda Reviewer +1')
  await expect(labels).toContainText('ReviewersAda Reviewer, Test User')

  const files = win.getByRole('listbox', { name: 'Files' }).getByRole('option')
  await expect(files).toHaveText([/Commit Message/, /docs\/new\.md/, /src\/a\.ts/])
  await expect(win.getByRole('region', { name: 'Diff of Commit Message' })).toContainText('Change-Id: I')

  await files.filter({ hasText: 'src/a.ts' }).click()
  const diff = win.getByRole('region', { name: 'Diff of src/a.ts' })
  await expect(diff.locator('table.diff-split')).toBeVisible()
  const row = diff.locator('tr', { hasText: 'export const b = 2' })
  await expect(row).toContainText('export const bb = 2') // old and new side by side in one row
  expect(mock.requests.some((r) => r.url.includes(`/revisions/${'b'.repeat(40)}/files/src%2Fa.ts/diff`))).toBe(true) // path URL-encoded

  await win.getByLabel('Patch set').selectOption('1')
  await expect.poll(() => mock.find('GET', '/revisions/' + 'a'.repeat(40) + '/files').length).toBeGreaterThan(0)
  await win.getByLabel('Patch set').selectOption('2')
  await win.getByLabel('Base').selectOption('1')
  await expect.poll(() => mock.find('GET', 'files?base=1').length).toBeGreaterThan(0)

  // Open in browser goes to the configured Gerrit only.
  await g.app.evaluate(({ shell }) => {
    shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
  })
  await win.getByRole('button', { name: 'Open #101 in browser' }).click()
  await expect.poll(() => g!.app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe(`${mock.url}/c/p/q/+/101`)
})

test('change not found → message and back', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  mock.intercept('GET', /\/detail$/, () => ({ status: 404, body: 'Not found: 101' }))
  await win.getByRole('option', { name: /Add feature X/ }).click()
  await expect(win.getByRole('alert')).toContainText('Gerrit error 404: Not found: 101')
  await win.getByRole('button', { name: 'Back' }).click()
  await expect(win.getByText('Select a change')).toBeVisible()
})
