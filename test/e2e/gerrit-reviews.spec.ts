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
  await expect(section('Outgoing').getByRole('option').first()).toContainText('#101 · Open · 1 unresolved · CR −1 · V ✓')
  await expect(section('Outgoing').getByRole('option').first()).toContainText('V ✓')
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

test('History: paged list of the project, load more, owner: + status: search, open a change', async () => {
  const old = mock.changes.find((c) => c._number === 90)!
  for (let i = 0; i < 60; i++) mock.changes.push({ ...old, _number: 200 + i, subject: `Old change ${i}`, updated: '2026-09-01 10:00:00.000000000' })
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('radio', { name: 'History' }).or(win.getByRole('button', { name: 'History', exact: true })).click()
  const list = win.getByRole('listbox', { name: 'Review history' })
  await expect(list.getByRole('option').first()).toContainText('Draft: refactor')
  const searches = () => mock.find('GET', '/a/changes/?').map((r) => new URL(r.url, 'http://x').searchParams).filter((p) => p.has('n'))
  expect(searches().at(-1)!.get('q')).toBe('project:"p/q"')
  expect(searches().at(-1)!.get('S')).toBe('0')

  // Infinite scroll: scrolling to the end asks for the next page (S=50) and shows its rows.
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect.poll(() => searches().some((p) => p.get('S') === '50')).toBe(true)
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(list.getByRole('option').filter({ hasText: 'Old change 0#200 ·' })).toBeVisible()

  const box = win.getByRole('searchbox', { name: 'Search reviews' })
  await box.fill('bogus:1')
  await box.press('Enter')
  await expect(win.getByRole('alert')).toContainText('Unknown qualifier bogus:')
  await box.fill('owner:self status:merged import')
  await box.press('Enter')
  await expect(list.getByRole('option')).toHaveCount(1)
  expect(searches().at(-1)!.get('q')).toBe('project:"p/q" message:"import" owner:"self" status:"merged"')
  const before = searches().length
  await box.fill('') // what the native clear (×) reports
  await expect.poll(() => searches().length).toBeGreaterThan(before)
  expect(searches().at(-1)!.get('q')).toBe('project:"p/q"')
  await expect(list.getByRole('option')).not.toHaveCount(1)
  await box.fill('owner:self status:merged import')
  await box.press('Enter')
  await expect(list.getByRole('option')).toHaveCount(1)
  await list.getByRole('option').filter({ hasText: '#90 · Merged' }).click()
  await expect(win.getByRole('heading', { name: 'Initial import' })).toBeVisible()
})
