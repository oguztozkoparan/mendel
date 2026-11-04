import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { commitForChange, connectGerrit, gerritPushOutput, launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

const refs = (g: GerritApp) => g.fx.git(['for-each-ref', '--format=%(refname)', 'refs/for'], g.fx.remote)

test('send for review with topic, reviewer and WIP pushes the %-ref and toasts the parsed change', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  await connectGerrit(win, mock)
  commitForChange(fx, 'x.txt', 101)
  gerritPushOutput(fx, `${mock.url}/c/p/q/+/101 Add x.txt [NEW]`)
  await win.getByRole('button', { name: 'Send for review ↑1' }).click()
  const dialog = win.getByRole('dialog', { name: 'Send for review' })
  await expect(dialog.getByRole('list', { name: 'Commits to send' }).getByRole('listitem')).toHaveCount(1)
  await expect(dialog.getByRole('note')).toHaveCount(0)
  await dialog.getByLabel('Topic').fill('t')
  await dialog.getByLabel('Reviewers').fill('a@b.c')
  await dialog.getByLabel('Work in progress').check()
  await expect(dialog.getByLabel('Push ref')).toHaveText('HEAD:refs/for/main%topic=t,r=a@b.c,wip')
  await dialog.getByLabel('Reviewers').fill('a@b.c,r=x y')
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled()
  await dialog.getByLabel('Reviewers').fill('a@b.c')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(win.getByRole('alert').filter({ hasText: 'Created change #101' })).toBeVisible()
  expect(refs(g)).toBe('refs/for/main%topic=t,r=a@b.c,wip')
  await win.getByRole('button', { name: 'Open change #101' }).click()
  await expect(win.getByRole('heading', { name: 'Add feature X' })).toBeVisible()
})

test('N>1 commits are listed with a warning; a commit without Change-Id blocks sending until fixed', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  commitForChange(fx, 'a.txt', 201)
  fx.commitFile('b.txt', 'b\n', 'No change id')
  await win.getByRole('button', { name: 'Send for review ↑2' }).click()
  const dialog = win.getByRole('dialog', { name: 'Send for review' })
  await expect(dialog.getByRole('list', { name: 'Commits to send' }).getByRole('listitem')).toHaveCount(2)
  await expect(dialog.getByRole('note')).toHaveText('This creates/updates 2 changes.')
  const send = dialog.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  await dialog.getByRole('button', { name: 'Add Change-Id to last commit' }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await send.click()
  await expect(dialog).toHaveCount(0)
  await expect(win.getByRole('alert').filter({ hasText: 'Sent for review' })).toBeVisible()
  expect(refs(g)).toBe('refs/for/main')
  expect(fx.git(['log', '-1', '--format=%B'])).toMatch(/^No change id\n\nChange-Id: I[0-9a-f]{40}$/)
})

test('Gerrit pulls with rebase regardless of the merge setting', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  const other = `${fx.dir}/other`
  fx.git(['clone', '-q', fx.remote, other], fx.dir)
  writeFileSync(`${other}/r.txt`, 'r\n')
  fx.git(['add', 'r.txt'], other)
  fx.git(['commit', '-q', '-m', 'remote r'], other)
  fx.git(['push', '-q'], other)
  commitForChange(fx, 'x.txt', 301)
  await win.getByRole('button', { name: 'Sync options' }).click()
  await win.getByRole('menuitem', { name: 'Fetch' }).click()
  await win.getByRole('button', { name: 'Pull ↓1 ↑1' }).click()
  await expect(win.getByRole('button', { name: 'Send for review ↑1' })).toBeVisible()
  expect(fx.git(['rev-list', '--merges', '--count', 'HEAD'])).toBe('0')
  expect(fx.git(['log', '-1', '--format=%s', 'HEAD~1'])).toBe('remote r')
})

test('HEAD with an open change: history badge, amend pre-ticked as new patchset, upload succeeds', async () => {
  mock.changes[0].work_in_progress = true
  g = await launchGerrit(mock)
  const { win, fx } = g
  await connectGerrit(win, mock)
  commitForChange(fx, 'x.txt', 101)

  await win.getByRole('tab', { name: 'History' }).click()
  const commits = win.getByRole('grid', { name: 'Commits' })
  await expect(commits.getByRole('row', { name: 'Add x.txt' })).toContainText('in review #101')
  await expect(commits.getByRole('row', { name: 'initial commit' })).not.toContainText('in review')

  await win.getByRole('tab', { name: 'Changes' }).click()
  const box = win.getByRole('form', { name: 'Commit' })
  await expect(box.getByRole('checkbox', { name: 'Amend last commit' })).toBeChecked()
  await expect(box).toContainText('Will upload a new patchset of #101')
  await expect(box.getByLabel('Summary')).toHaveValue('Add x.txt')
  writeFileSync(`${fx.work}/x.txt`, 'x v2\n')
  fx.git(['add', 'x.txt'])
  const count = fx.git(['rev-list', '--count', 'HEAD'])
  await box.getByRole('button', { name: 'Amend last commit' }).click()
  await expect(win.getByText('No local changes')).toBeVisible()
  expect(fx.git(['rev-list', '--count', 'HEAD'])).toBe(count)
  expect(fx.git(['log', '-1', '--format=%B'])).toBe(`Add x.txt\n\nChange-Id: I${'101'.padStart(40, '0')}`)

  gerritPushOutput(fx, `${mock.url}/c/p/q/+/101 Add x.txt`)
  await win.getByRole('button', { name: 'Send for review ↑1' }).click()
  const dialog = win.getByRole('dialog', { name: 'Send for review' })
  await dialog.getByLabel(/Mark ready/).check()
  await expect(dialog.getByLabel('Push ref')).toHaveText('HEAD:refs/for/main%ready')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(win.getByRole('alert').filter({ hasText: 'New patchset uploaded to #101' })).toBeVisible()
  expect(refs(g)).toBe('refs/for/main%ready')
})

test('pre-ticked amend waits for the fresh HEAD message (commit made outside, slow commit:info)', async () => {
  g = await launchGerrit(mock)
  const { app, win, fx } = g
  await connectGerrit(win, mock) // Changes tab unmounted: its cached HEAD message is now 'initial commit'
  commitForChange(fx, 'x.txt', 101)
  // Make the HEAD message arrive after the Gerrit hint, as under load (handler delayed in main).
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
    const orig = handlers.get('commit:info')!
    handlers.set('commit:info', async (...a) => (await new Promise((r) => setTimeout(r, 1500)), orig(...a)))
  })
  await win.getByRole('tab', { name: 'Changes' }).click()
  const box = win.getByRole('form', { name: 'Commit' })
  await expect(box.getByRole('checkbox', { name: 'Amend last commit' })).toBeChecked()
  await expect(box.getByLabel('Summary')).toHaveValue('Add x.txt')
  await expect(box.getByLabel('Description')).toHaveValue(`Change-Id: I${'101'.padStart(40, '0')}`)
})
