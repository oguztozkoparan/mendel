import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'
import { connectGerrit, launchGerrit, type GerritApp } from './gerrit'

let mock: GerritMock
let g: GerritApp | null = null
test.beforeEach(async () => void (mock = await startGerritMock({ password: 'S3cret-http-pw' })))
test.afterEach(async () => {
  await g?.close()
  g = null
  await mock.close()
})
const providersJson = () => readFileSync(path.join(g!.userData, 'providers.json'), 'utf8')

test('wrong password → 401 message, nothing stored', async () => {
  g = await launchGerrit(mock)
  const { win } = g
  await win.getByRole('tab', { name: 'Reviews' }).click()
  await win.getByRole('button', { name: 'Connect…' }).click()
  const dialog = win.getByRole('dialog', { name: /Connect to Gerrit/ })
  await expect(dialog.getByLabel('Username')).toHaveValue('test') // from the ssh remote
  await dialog.getByLabel('HTTP password / token').fill('wrong')
  await dialog.getByRole('button', { name: 'Test & save' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Wrong username or HTTP password / token')
  expect(mock.find('GET', '/a/accounts/self').at(-1)!.headers.authorization).toMatch(/^Basic /)
  expect(JSON.parse(providersJson()).credentials ?? {}).toEqual({})
})

test('correct password → "Connected as …", secret stored encrypted, never in plain text', async () => {
  g = await launchGerrit(mock)
  const { app, win } = g
  await connectGerrit(win, mock)
  await expect(win.getByRole('region', { name: 'Connect to Gerrit' })).toBeHidden()
  const raw = providersJson()
  expect(raw).not.toContain('S3cret-http-pw')
  expect(raw).not.toContain(Buffer.from('test:S3cret-http-pw').toString('base64'))
  const host = new URL(mock.url).host
  // Linux CI without a keyring keeps it for the session only (TECH.md §6.5).
  if (process.platform !== 'linux') expect(JSON.parse(raw).credentials[host]).toMatchObject({ username: 'test', secret: expect.any(String) })

  // "Get your HTTP password" opens the configured Gerrit only; other origins are dropped.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (u: string) => void g.__opened.push(u)
  })
  await win.getByRole('button', { name: 'Account…' }).click()
  await win.getByRole('button', { name: 'Get your HTTP password' }).click()
  await win.evaluate(async () => {
    const { current } = await window.mendel['repo:list']()
    await window.mendel['gerrit:open']({ repo: current!, path: 'https://evil.example.com/' })
    await window.mendel['gerrit:open']({ repo: current!, path: '//evil.example.com/x' })
  })
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([`${mock.url}/settings/#HTTPCredentials`])

  // Remove deletes the stored secret.
  await win.getByRole('button', { name: 'Remove credentials' }).click()
  await expect(win.getByRole('region', { name: 'Connect to Gerrit' })).toBeVisible()
  expect(JSON.parse(providersJson()).credentials).toEqual({})
})
