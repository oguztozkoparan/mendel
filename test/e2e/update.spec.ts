import { expect, test, type ElectronApplication } from '@playwright/test'
import { startMockServer, type MockServer } from '../fixtures/mock-server'
import { launchApp, type LaunchedApp } from './launch'

// Real electron-updater against a mock generic feed; only download + install are stubbed (PLAN.md §8 Updates).
let version = '99.0.0'
const yml = () =>
  `version: ${version}\nfiles:\n  - url: gitdock-${version}-arm64.dmg\n    sha512: AAAA\n    size: 1\n` +
  `path: gitdock-${version}-arm64.dmg\nsha512: AAAA\nreleaseDate: '2026-01-01T00:00:00.000Z'\nreleaseNotes: '<p>New <b>stuff</b></p>'\n`
let feed: MockServer
let launched: LaunchedApp | null = null

test.beforeAll(async () => {
  const route = () => ({ body: yml() })
  feed = await startMockServer(
    Object.fromEntries(['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'].map((f) => [`GET /${f}`, route]))
  )
})
test.afterAll(() => feed.close())
test.afterEach(async () => {
  await launched?.close()
  launched = null
})

async function launch(feedUrl: string, selfInstall: boolean): Promise<LaunchedApp> {
  launched = await launchApp({ GITDOCK_E2E_UPDATE_FEED: feedUrl, GITDOCK_E2E_SELF_INSTALL: selfInstall ? '1' : '0' })
  return launched
}

const stubInstall = (app: ElectronApplication) =>
  app.evaluate(() => {
    const g = globalThis as unknown as { __gitdockUpdater: NodeJS.EventEmitter & Record<string, unknown>; __installed?: boolean }
    const u = g.__gitdockUpdater
    u.downloadUpdate = async () => {
      u.emit('download-progress', { percent: 42, bytesPerSecond: 1, total: 100, transferred: 42, delta: 42 })
      await new Promise((r) => setTimeout(r, 300))
      u.emit('update-downloaded', { version: '99.0.0' })
      return []
    }
    u.quitAndInstall = () => void (g.__installed = true)
  })

test('newer version: pill, notes, download progress, restart to update', async () => {
  version = '99.0.0'
  const { app, win } = await launch(feed.url, true)
  await stubInstall(app)
  await win.getByRole('button', { name: 'Check for updates' }).click()
  await win.getByRole('button', { name: 'Update v99.0.0 available' }).click()
  await expect(win.getByRole('dialog', { name: 'gitdock 99.0.0' })).toContainText('New stuff')
  await win.getByRole('button', { name: 'Download' }).click()
  await expect(win.getByRole('progressbar', { name: 'Downloading update' })).toBeVisible()
  await win.getByRole('button', { name: 'Restart to update' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as { __installed?: boolean }).__installed)).toBe(true)
})

test('newer version without self-install opens the download page', async () => {
  version = '99.0.0'
  const { app, win } = await launch(feed.url, false)
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => void ((globalThis as { __opened?: string }).__opened = url)
  })
  await win.getByRole('button', { name: 'Check for updates' }).click()
  await win.getByRole('button', { name: 'Update v99.0.0 available' }).click()
  await win.getByRole('button', { name: 'Download' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gitdock-99\.0\.0-arm64\.dmg$/)
})

test('same version: up to date', async () => {
  const { app, win } = await launch(feed.url, true)
  version = await app.evaluate(({ app }) => app.getVersion())
  await win.getByRole('button', { name: 'Check for updates' }).click()
  await expect(win.getByRole('status')).toHaveText(`You're up to date (v${version})`)
})

test('unreachable feed: error with retry, app unaffected', async () => {
  const dead = await startMockServer({})
  await dead.close()
  const { win } = await launch(dead.url, true)
  await win.getByRole('button', { name: 'Check for updates' }).click()
  await expect(win.getByRole('alert')).toContainText('Update check failed')
  await win.getByRole('button', { name: 'Retry' }).click()
  await expect(win.getByRole('alert')).toContainText('Update check failed')
  await expect(win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
})
