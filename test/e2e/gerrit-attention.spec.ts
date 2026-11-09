import { expect, test } from '@playwright/test'
import { OTHER, startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { connectGerrit, launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock()))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})

test('attention set: your-turn marker, remove me, add a reviewer; hashtags add/remove', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await connectGerrit(win, mock)
  const row = win.getByRole('option', { name: /Add feature X/ })
  await expect(row).toContainText('Your turn · #101')
  await row.click()

  const labels = win.getByRole('region', { name: 'Labels' })
  await expect(labels).toContainText('Needs your attention')
  await labels.getByRole('button', { name: 'Remove me' }).click()
  await expect(labels).not.toContainText('Needs your attention')
  expect(JSON.parse(mock.find('POST', '/a/changes/101/attention/self/delete').at(-1)!.body!)).toHaveProperty('reason')
  await expect(row).not.toContainText('Your turn')

  await labels.getByLabel('Add to attention').selectOption({ label: 'Ada Reviewer' })
  await labels.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(labels).toContainText('AttentionAda Reviewer')
  expect(JSON.parse(mock.find('POST', '/a/changes/101/attention').at(-1)!.body!)).toMatchObject({ user: String(OTHER._account_id) })

  await expect(labels).toContainText('#ux')
  await labels.getByLabel('New hashtag').fill('bad tag')
  await labels.getByRole('button', { name: 'Add hashtag' }).click()
  await expect(labels.getByRole('alert')).toContainText('spaces or commas')
  expect(mock.find('POST', '/hashtags')).toHaveLength(0)

  await labels.getByLabel('New hashtag').fill('#perf')
  await labels.getByRole('button', { name: 'Add hashtag' }).click()
  await expect(labels).toContainText('#perf')
  expect(JSON.parse(mock.find('POST', '/hashtags').at(-1)!.body!)).toEqual({ add: ['perf'], remove: [] })
  await labels.getByRole('button', { name: 'Remove hashtag ux' }).click()
  await expect(labels).not.toContainText('#ux')
})
