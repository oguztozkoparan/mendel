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

test('related changes: chain with current highlighted and outdated marked; click opens that change', async () => {
  const rel = (n: number, subject: string, ps: number, cur: number, status = 'NEW') => ({ project: 'p/q', change_id: `I${n}`, commit: { commit: String(n).padEnd(40, '0'), parents: [], subject }, _change_number: n, _revision_number: ps, _current_revision_number: cur, status })
  mock.changes.find((c) => c._number === 101)!.related = [rel(103, 'Draft: refactor', 1, 2), rel(101, 'Add feature X', 2, 2), rel(90, 'Initial import', 1, 1, 'MERGED')]
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()

  const related = win.getByRole('region', { name: 'Related changes' })
  const items = related.getByRole('listitem')
  await expect(items).toHaveText(['Draft: refactor #103 · Open · Outdated (PS 1 of 2)', 'Add feature X #101 · Open', 'Initial import #90 · Merged'])
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(related.getByRole('button', { name: 'Add feature X' })).toHaveCount(0) // the current change is not a link

  await related.getByRole('button', { name: 'Draft: refactor' }).click()
  await expect(win.getByRole('heading', { name: 'Draft: refactor' })).toBeVisible()
  await expect(win.getByRole('region', { name: 'Related changes' })).toHaveCount(0) // #103 has no relations in the mock
})
