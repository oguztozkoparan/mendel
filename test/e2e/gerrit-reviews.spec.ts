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

test('reviews list: Outgoing / Incoming / Closed; "This project only" adds project: to the queries', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  const list = win.getByRole('listbox', { name: 'Reviews' })
  const section = (name: string) => list.getByRole('group', { name })
  await expect(section('Outgoing').getByRole('option')).toHaveCount(1)
  await expect(section('Outgoing').getByRole('option').first()).toContainText('Add feature X')
  await expect(section('Outgoing').getByRole('option').first()).toContainText('#101 · Open · 1 unresolved · CR −1 · V +1')
  await expect(section('Outgoing').getByRole('option').first()).toContainText('V +1')
  await expect(section('Incoming').getByRole('option')).toHaveCount(1)
  await expect(section('Incoming').getByRole('option').first()).toContainText('#103 · Open · WIP')
  await expect(section('Recently closed').getByRole('option').first()).toContainText('#90 · Merged')

  const qs = () => new URL(mock.find('GET', '/a/changes/?').at(-1)!.url, 'http://x').searchParams.getAll('q')
  expect(qs()).toEqual(['status:open owner:self project:"p/q"', 'status:open reviewer:self -owner:self project:"p/q"', 'owner:self -is:open limit:10 project:"p/q"'])

  await win.getByText('This project only').click()
  await expect(win.getByRole('checkbox', { name: 'This project only' })).not.toBeChecked()
  await expect(section('Incoming').getByRole('option')).toHaveCount(2)
  await expect(section('Incoming')).toContainText('Fix crash in parser')
  expect(qs().some((q) => q.includes('project:'))).toBe(false)
})

test('rejected credential → "Connect to Gerrit" with expiry hint; server error → retry', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await expect(win.getByRole('listbox', { name: 'Reviews' })).toBeVisible()

  mock.intercept('GET', /^\/a\/changes\/$/, () => ({ status: 503, body: 'Service Unavailable' }))
  await win.getByRole('button', { name: 'Refresh reviews' }).click()
  await expect(win.getByRole('alert')).toContainText('Gerrit error 503')
  mock.intercept('GET', /^\/a\/changes\/$/, () => ({ status: 401, body: 'Unauthorized' }))
  await win.getByRole('button', { name: 'Retry' }).click()
  await expect(win.getByRole('region', { name: 'Connect to Gerrit' })).toContainText('may have expired')
})
