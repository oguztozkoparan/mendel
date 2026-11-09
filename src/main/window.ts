import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron'
import { release } from 'node:os'
import path from 'node:path'
import { appEntryUrl } from './security'
import { getWindowState, setWindowState } from './settings'

const MIN = { width: 960, height: 600 }

/** Saved bounds fitted into the work area of the display they overlap most (a display may have been removed). */
export function fitBounds(b: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.max(MIN.width, Math.min(b.width, workArea.width))
  const height = Math.max(MIN.height, Math.min(b.height, workArea.height))
  const x = Math.min(Math.max(b.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(b.y, workArea.y), workArea.y + workArea.height - height)
  return { x, y, width, height }
}

/** Native glass behind the transparent page: macOS vibrancy, or Mica on Windows 11 22H2+ (build 22621). Linux stays opaque. */
export const glass = process.platform === 'darwin' || (process.platform === 'win32' && Number(release().split('.')[2]) >= 22621)

/**
 * Windows/Linux draw the window controls over our toolbar; match them to its tokens (global.css):
 * --bg-side (translucent over Mica, else pre-composited over --bg) and --fg.
 */
const overlay = () => {
  const dark = nativeTheme.shouldUseDarkColors
  const color = glass ? (dark ? '#161c228c' : '#f6f8fa9e') : dark ? '#141a1f' : '#f9fbfc'
  return { color, symbolColor: dark ? '#e8eef2' : '#0f171e', height: 40 }
}

export function createMainWindow(): BrowserWindow {
  const mac = process.platform === 'darwin'
  const saved = getWindowState()
  const bounds = saved ? fitBounds(saved, screen.getDisplayMatching(saved).workArea) : { width: 1200, height: 800 }
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN.width,
    minHeight: MIN.height,
    show: false,
    title: 'Mendel',
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    ...(mac ? {} : { titleBarOverlay: overlay() }),
    // Transparent page so the material shows through --bg-side; .main paints --bg (opaque diff/detail).
    ...(glass && { backgroundColor: '#00000000', ...(mac ? { vibrancy: 'sidebar' as const } : { backgroundMaterial: 'mica' as const }) }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      devTools: !app.isPackaged
    }
  })
  win.once('ready-to-show', () => (saved?.maximized && win.maximize(), win.show()))
  win.on('close', () => setWindowState({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  if (!mac) {
    const update = () => win.setTitleBarOverlay(overlay())
    nativeTheme.on('updated', update)
    win.on('closed', () => nativeTheme.off('updated', update))
  }
  void win.loadURL(appEntryUrl)
  return win
}
