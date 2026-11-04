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
