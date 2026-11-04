import { expect, test, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { connectGerrit, launchGerrit, type GerritApp } from './gerrit'
import { launchApp } from './launch'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

async function openFile(win: Page, file = 'src/a.ts') {
  await win.getByRole('option', { name: /Add feature X/ }).click()
  await win.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: new RegExp(file) }).click()
  return win.getByRole('region', { name: `Diff of ${file}` })
}

test('threads grouped by in_reply_to with sanitized markdown; links only to the configured Gerrit', async () => {
  g = await launchGerrit(mock)
  const { app, win } = g
  await connectGerrit(win, mock)
  const diff = await openFile(win)
  const thread = diff.getByRole('group', { name: 'Comment thread by Ada Reviewer' }).filter({ hasText: 'Please' })
  await expect(thread).toContainText('Which name?') // reply c2 in the same thread as c1
  await expect(thread).toContainText('Unresolved')
  await expect(thread.locator('strong', { hasText: 'rename' })).toBeVisible() // markdown, not raw **
  await expect(diff.getByRole('group').filter({ hasText: 'Old side note' })).toContainText('Resolved')
  await expect(win.getByRole('listbox', { name: 'Files' }).getByRole('option', { name: /src\/a\.ts/ })).toContainText('3 comments')

  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (u: string) => void g.__opened.push(u)
  })
  await thread.getByRole('link', { name: 'docs' }).click()
  await win.waitForTimeout(300)
  expect(await app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([]) // example.com is not the Gerrit host
})

test('vote pickers show exactly permitted_labels (Code-Review + Verified, then Code-Review only)', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  await win.getByRole('option', { name: /Add feature X/ }).click()
  await win.getByRole('button', { name: /^Reply…/ }).click()
  const dialog = win.getByRole('dialog', { name: 'Reply to #101' })
  await expect(dialog.getByRole('radiogroup')).toHaveCount(2)
  await expect(dialog.getByRole('radiogroup', { name: 'Code-Review' }).getByRole('radio')).toHaveCount(5)
  await expect(dialog.getByRole('radiogroup', { name: 'Code-Review' })).toContainText('−2−10+1+2')
  await expect(dialog.getByRole('radiogroup', { name: 'Verified' })).toContainText('−10+1')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  mock.changes[0].permitted_labels = { 'Code-Review': ['-1', ' 0', '+1'] }
  const fetched = mock.find('GET', '/changes/101/detail').length
  await win.getByRole('option', { name: /Fix crash|Initial import/ }).first().click()
  await win.getByRole('option', { name: /Add feature X/ }).click()
  await expect.poll(() => mock.find('GET', '/changes/101/detail').length).toBeGreaterThan(fetched)
  await win.getByRole('button', { name: /^Reply…/ }).click()
  await expect(dialog.getByRole('radiogroup')).toHaveCount(1)
  await expect(dialog.getByRole('radiogroup', { name: 'Code-Review' })).toContainText('−10+1')
})

test('reply sends one review POST with message, labels and pending comments; failure keeps them; drafts survive restart', async () => {
  g = await launchGerrit(mock)
  let { win } = g
  await connectGerrit(win, mock)
  let diff = await openFile(win)

  // New inline comment from the gutter (new side, line 2) and a "Done" on the existing thread.
  await diff.locator('tr', { hasText: 'export const b = 2' }).locator('td.diff-gutter').nth(1).click()
  await diff.getByLabel('Comment on line 2').fill('Typo here')
  await diff.getByRole('button', { name: 'Save draft' }).click()
  await diff.getByRole('group').filter({ hasText: 'Which name?' }).getByRole('button', { name: 'Done' }).click()
  await expect(diff.getByRole('group', { name: 'Draft comment' })).toHaveCount(2)

  // Drafts are local and survive a restart.
  await g.app.close()
  const relaunched = await launchApp({ ...g.fx.env, MENDEL_E2E_USERDATA: g.userData })
  const { fx, userData } = g
  g = { ...g, ...relaunched, close: async () => (await relaunched.close(), fx.cleanup(), rmSync(path.dirname(userData), { recursive: true, force: true })) }
  win = g.win
  await win.getByRole('tab', { name: 'Reviews' }).click()
  diff = await openFile(win)
  await expect(diff.getByRole('group', { name: 'Draft comment' })).toHaveCount(2)

  let fail = true
  mock.intercept('POST', /\/review$/, () => (fail ? { status: 500, body: 'Internal server error' } : undefined))
  await win.getByRole('button', { name: 'Reply… (2 pending)' }).click()
  const dialog = win.getByRole('dialog', { name: 'Reply to #101' })
  await dialog.getByLabel('Message').fill('Looks fine overall')
  await dialog.getByRole('radiogroup', { name: 'Code-Review' }).getByText('+1').click()
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Gerrit error 500')
  await expect(dialog.getByRole('list', { name: 'Pending comments' }).getByRole('listitem')).toHaveCount(2)

  fail = false
  const before = mock.find('POST', '/review').length
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog).toBeHidden()
  const posts = mock.find('POST', '/review').slice(before)
  expect(posts).toHaveLength(1)
  expect(posts[0].url).toBe('/a/changes/101/revisions/2/review')
  expect(JSON.parse(posts[0].body)).toEqual({
    message: 'Looks fine overall',
    labels: { 'Code-Review': 1 },
    comments: {
      'src/a.ts': [
        { line: 2, message: 'Typo here', unresolved: true },
        { line: 2, in_reply_to: 'c2', message: 'Done', unresolved: false }
      ]
    }
  })
  await expect(diff.getByRole('group', { name: 'Draft comment' })).toHaveCount(0)
  await expect(win.getByRole('region', { name: 'Labels' })).toContainText('Test User +1') // detail reloaded
  await expect(diff.getByRole('group').filter({ hasText: 'Typo here' })).toContainText('Test User')
})

test('reply across patch sets: older ones first, current last; drafts dropped per successful call', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  const repo = await win.evaluate(() => window.mendel['repo:list']().then((r) => r.current!))
  const drafts = [
    { key: 'k1', path: 'src/a.ts', patch_set: 1, line: 1, in_reply_to: 'old1', message: 'Fixed in PS2', unresolved: false },
    { key: 'k2', path: 'src/a.ts', patch_set: 2, line: 2, message: 'New note', unresolved: true }
  ]
  await win.evaluate(([k, v]) => localStorage.setItem(k, v), [`mendel.gerrit.pending.${repo}.101`, JSON.stringify(drafts)])
  await openFile(win)

  let fail = true
  mock.intercept('POST', /\/revisions\/2\/review$/, () => (fail ? { status: 500, body: 'Internal server error' } : undefined))
  const before = mock.find('POST', '/review').length
  await win.getByRole('button', { name: 'Reply… (2 pending)' }).click()
  const dialog = win.getByRole('dialog', { name: 'Reply to #101' })
  await dialog.getByLabel('Message').fill('Updated')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Gerrit error 500')
  const pending = dialog.getByRole('list', { name: 'Pending comments' }).getByRole('listitem')
  await expect(pending).toHaveCount(1) // the PS 1 reply went through and is not kept for a retry
  await expect(pending).toContainText('New note')
  const first = mock.find('POST', '/review').slice(before)
  expect(first.map((r) => r.url)).toEqual(['/a/changes/101/revisions/1/review', '/a/changes/101/revisions/2/review'])
  expect(JSON.parse(first[0].body)).toEqual({ labels: {}, comments: { 'src/a.ts': [{ line: 1, in_reply_to: 'old1', message: 'Fixed in PS2', unresolved: false }] } })

  fail = false
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog).toBeHidden()
  const retry = mock.find('POST', '/review').slice(before + 2)
  expect(retry.map((r) => r.url)).toEqual(['/a/changes/101/revisions/2/review'])
  expect(JSON.parse(retry[0].body)).toMatchObject({ message: 'Updated', comments: { 'src/a.ts': [{ line: 2, message: 'New note' }] } })
})
