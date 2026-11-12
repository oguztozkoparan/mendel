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
  await expect(files).toHaveText([/Commit Message/, /new\.md.*docs/, /a\.ts.*src/]) // name first, then its folder
  await expect(win.getByRole('region', { name: 'Diff of Commit Message' })).toContainText('Change-Id: I')

  await win.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: 'src/a.ts' }).click()
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

  // Copy fetch command for the selected patch set, through main's clipboard.
  await win.getByRole('button', { name: 'More actions' }).click()
  await win.getByRole('menuitem', { name: 'Copy fetch command' }).click()
  await expect(win.getByText('Fetch command copied')).toBeVisible()
  expect(await g.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('git fetch origin refs/changes/01/101/2 && git checkout FETCH_HEAD')
})

test('change description: the selected patch set\'s message body as Markdown with its line breaks, HTML as text, trailers as in History; nothing without a body', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()
  expect(mock.find('GET', '/detail?').at(-1)!.url).toContain('o=ALL_COMMITS')

  const desc = win.getByRole('region', { name: 'Change description' })
  // subject only as the heading; body as Markdown: one paragraph that keeps its line breaks, HTML-looking text literal, trailers split off
  expect(await desc.textContent()).toBe(`Adds feature X behind a flag.\nKeeps bold and <tag> as typed.\nSee https://example.com/spec and ${mock.url}/c/p/q/+/90`)
  await expect(desc.locator('p')).toHaveCount(1)
  await expect(desc.locator('p')).toHaveCSS('white-space', 'pre-wrap')
  await expect(desc.locator('strong')).toHaveText('bold')
  await expect(desc.locator('tag, img, script')).toHaveCount(0)
  await expect(desc).toHaveAttribute('tabindex', '0')
  // a link on the configured Gerrit opens through main; any other is copied, never opened
  await g.app.evaluate(({ shell }) => {
    shell.openExternal = async (u: string) => void ((globalThis as { __opened?: string }).__opened = u)
  })
  await desc.getByRole('link', { name: 'https://example.com/spec' }).click()
  await expect(desc.getByRole('status')).toHaveText('Copied')
  await expect.poll(() => g!.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/spec')
  expect(await g.app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBeUndefined()
  await desc.getByRole('link', { name: `${mock.url}/c/p/q/+/90` }).click()
  await expect.poll(() => g!.app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe(`${mock.url}/c/p/q/+/90`)
  const trailers = win.getByLabel('Trailers')
  await expect(trailers).toContainText('Change-ID')
  await expect(trailers).toContainText('Reviewed on')
  await expect(trailers.getByRole('button', { name: 'Test User, Signed-off' })).toBeVisible()
  const changeId = `I${'0'.repeat(37)}101`
  await trailers.getByRole('button', { name: `Copy ${changeId}` }).click()
  await expect.poll(() => g!.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(changeId)
  // Reviewed-on on the configured Gerrit opens through gerrit:open, as in History
  await trailers.getByRole('button', { name: `Open ${mock.url}/c/p/q/+/101 in browser` }).click()
  await expect.poll(() => g!.app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toBe(`${mock.url}/c/p/q/+/101`)

  // follows the selected patch set
  await win.getByLabel('Patch set').selectOption('1')
  await expect(desc).toHaveText('First draft of feature X.')
  await expect(trailers.getByRole('button', { name: 'Test User, Signed-off' })).toHaveCount(0)

  // subject only: no description block, no trailers
  await win.getByRole('option', { name: /Draft: refactor/ }).click()
  await expect(win.getByRole('heading', { name: 'Draft: refactor' })).toBeVisible()
  await expect(desc).toHaveCount(0)
  await expect(trailers).toHaveCount(0)

  // trailers only: no empty message block, the trailers still show
  await win.getByText('This project only').click()
  await win.getByRole('option', { name: /Fix crash in parser/ }).click()
  await expect(win.getByRole('heading', { name: 'Fix crash in parser' })).toBeVisible()
  await expect(trailers.getByRole('button', { name: `Copy I${'0'.repeat(37)}102` })).toBeVisible()
  await expect(desc).toHaveCount(0)
})

test('a renamed file row: name, then old → new folder; status, both paths and counts in its name and tooltip', async () => {
  mock.changes.find((c) => c._number === 101)!.files['b'.repeat(40)]['lib/b.ts'] = { status: 'R', old_path: 'src/b.ts', lines_inserted: 1, diff: [{ ab: ['x'] }] }
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()
  const row = win.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: 'R src/b.ts → lib/b.ts +1 −0' })
  await expect(row).toHaveText(/^Rb\.tssrc → lib\+1−0$/)
  await expect(row.locator('[data-tip]')).toHaveAttribute('data-tip', 'src/b.ts → lib/b.ts')
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
