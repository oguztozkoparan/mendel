import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { commitForChange, connectGerrit, launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

test('no hook: commit gets a Change-Id from gitdock; unpushed HEAD without one gets the fix action', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  const hooks = readdirSync(path.join(fx.work, '.git/hooks'))
  const box = win.getByRole('form', { name: 'Commit' })
  await expect(box).toContainText('Change-Id will be added by gitdock')

  writeFileSync(path.join(fx.work, 'a.txt'), 'a\n')
  fx.git(['add', 'a.txt'])
  await box.getByLabel('Summary').fill('Add a')
  await box.getByRole('button', { name: 'Commit to main' }).click()
  await expect(win.getByText('No local changes')).toBeVisible()
  expect(fx.git(['log', '-1', '--format=%B'])).toMatch(/^Add a\n\nChange-Id: I[0-9a-f]{40}$/)
  await expect(box.getByRole('button', { name: 'Add Change-Id to last commit' })).toHaveCount(0)

  fx.commitFile('b.txt', 'b\n', 'Add b') // terminal commit: no Change-Id
  const fix = box.getByRole('button', { name: 'Add Change-Id to last commit' })
  await fix.click()
  await expect(fix).toHaveCount(0)
  expect(fx.git(['log', '-1', '--format=%B'])).toMatch(/^Add b\n\nChange-Id: I[0-9a-f]{40}$/)
  expect(readdirSync(path.join(fx.work, '.git/hooks'))).toEqual(hooks)
  expect(mock.requests.filter((r) => r.url.includes('/tools/hooks'))).toHaveLength(0) // hook never downloaded
})

test('saving files refreshes local state only: no Gerrit lookup per save', async () => {
  g = await launchGerrit(mock)
  const { win, fx } = g
  await connectGerrit(win, mock)
  commitForChange(fx, 'x.txt', 101)
  await win.getByRole('tab', { name: 'History' }).click()
  await expect(win.getByRole('grid', { name: 'Commits' }).getByRole('row', { name: 'Add x.txt' })).toContainText('in review #101')
  await win.getByRole('tab', { name: 'Changes' }).click()
  await expect(win.getByRole('form', { name: 'Commit' })).toContainText('Will upload a new patchset of #101')
  const lookups = () => mock.find('GET', 'change:I').length
  await expect.poll(lookups).toBe(2) // commit hint + History badges, once for the new HEAD
  const files = win.getByRole('grid', { name: 'Changed files' })
  for (const name of ['y.txt', 'z.txt']) {
    writeFileSync(path.join(fx.work, name), `${name}\n`)
    await expect(files).toContainText(name)
  }
  expect(lookups()).toBe(2)
})
