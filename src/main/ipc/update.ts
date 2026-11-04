import { app, shell } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { UpdateState } from '../../shared/ipc'
import log from '../log'
import { redact } from '../redact'
import { testSeams } from '../security'
import { getSettings } from '../settings'
import { canSelfInstall, downloadUrl, externalAllowed, parseFeed, urlAllowed, type Feed } from '../update/feed'
import { emit, type Handlers } from '.'

const FIRST_CHECK_MS = 10_000
const CHECK_EVERY_MS = 6 * 60 * 60_000

// Test-only feed, honored only in e2e builds (S13, like GITDOCK_E2E_USERDATA); loopback http allowed there.
const e2e = testSeams && !!process.env.GITDOCK_E2E_USERDATA
let state: UpdateState = { status: 'idle' }
let feed: Feed | null = null
let info: UpdateInfo | null = null
let manual = false
let selfInstall = false

function set(next: UpdateState): void {
  state = next
  emit('update:state', state)
}

/** The feed comes only from the packaged app-update.yml (or the e2e env); the renderer can never set it. */
function loadFeed(): Feed | null {
  if (e2e) {
    const url = process.env.GITDOCK_E2E_UPDATE_FEED ?? ''
    return urlAllowed(url, true) ? { provider: 'generic', url } : null
  }
  if (!app.isPackaged) return null
  try {
    return parseFeed(readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'))
  } catch (err) {
    log.error('[update] no app-update.yml', err)
    return null
  }
}

function notesText(notes: UpdateInfo['releaseNotes']): string {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '')
  // GitHub returns HTML; the renderer shows plain text only (TECH.md §6.7).
  return raw.replace(/<br\s*\/?>|<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]*>/g, '').trim()
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return redact(msg.split('\n')[0]).slice(0, 200)
}

/** Menu "Check for Updates…": the result shows in the update pill. */
export const checkForUpdates = () => void check(true)

async function check(isManual: boolean): Promise<UpdateState> {
  if (!feed) {
    if (isManual) set({ status: 'error', message: 'Updates are not available in this build' })
    return state
  }
  if (state.status === 'downloading' || state.status === 'downloaded') return state
  manual = isManual
  // Background checks stay quiet unless they find something.
  if (manual) set({ status: 'checking' })
  await autoUpdater.checkForUpdates().catch(() => undefined) // reported through the 'error' event
  return state
}

/** Wire electron-updater; call once after `app.ready`. Checks on start and every 6 h in packaged builds. */
export function startUpdater(): void {
  feed = loadFeed()
  if (!feed) return log.info('[update] disabled: no valid feed')
  selfInstall = e2e
    ? process.env.GITDOCK_E2E_SELF_INSTALL === '1'
    : canSelfInstall(process.platform, {
        appImage: !!process.env.APPIMAGE,
        macAutoInstall: process.env.GITDOCK_MAC_AUTOINSTALL === 'true'
      })
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  if (e2e) autoUpdater.forceDevUpdateConfig = true // updater is otherwise inactive unpackaged
  autoUpdater.setFeedURL(feed)

  autoUpdater.on('update-available', (i) => {
    info = i
    set({ status: 'available', version: i.version, notes: notesText(i.releaseNotes), canInstall: selfInstall })
  })
  autoUpdater.on('update-not-available', () =>
    set(manual ? { status: 'up-to-date', version: app.getVersion() } : { status: 'idle' })
  )
  autoUpdater.on('download-progress', (p) => info && set({ status: 'downloading', version: info.version, percent: p.percent }))
  autoUpdater.on('update-downloaded', (i) => set({ status: 'downloaded', version: i.version }))
  autoUpdater.on('error', (err) => {
    if (manual || state.status === 'downloading') set({ status: 'error', message: errorText(err) })
  })

  // e2e-only seam: lets Playwright stub download/install on the real updater.
  if (e2e) Object.assign(globalThis, { __gitdockUpdater: autoUpdater })
  if (app.isPackaged) {
    const auto = () => getSettings().autoUpdateCheck && void check(false)
    setTimeout(auto, FIRST_CHECK_MS)
    setInterval(auto, CHECK_EVERY_MS)
  }
}

export const updateHandlers: Handlers<'update:state' | 'update:check' | 'update:download' | 'update:install'> = {
  'update:state': () => state,
  'update:check': () => check(true),
  'update:download': async () => {
    if (state.status !== 'available' || !feed || !info) return
    if (!selfInstall) {
      const url = downloadUrl(feed, info.version, info.files, process.platform)
      if (!externalAllowed(url, feed, e2e)) return log.warn('[update] blocked download url', url)
      return shell.openExternal(url)
    }
    set({ status: 'downloading', version: info.version, percent: 0 })
    await autoUpdater.downloadUpdate().catch(() => undefined) // reported through the 'error' event
  },
  'update:install': () => {
    // shortcut: restarts even if a git operation is running; add a busy check once git ops are tracked (PLAN.md §4.10).
    if (state.status === 'downloaded') autoUpdater.quitAndInstall()
  }
}
