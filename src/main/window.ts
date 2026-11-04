import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { appEntryUrl } from './security'

export function createMainWindow(): BrowserWindow {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'gitdock',
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    ...(mac ? {} : { titleBarOverlay: { height: 40 } }),
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
  win.once('ready-to-show', () => win.show())
  void win.loadURL(appEntryUrl)
  return win
}
