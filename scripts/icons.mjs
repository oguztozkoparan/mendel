// Rasterize build/icon.svg to build/icon.png (1024²); electron-builder derives .icns/.ico/Linux sizes from it.
// Run: npx electron scripts/icons.mjs
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8')

app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 500))
  const png = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' }).toPNG()
  writeFileSync(join(root, 'build/icon.png'), png)
  console.log(`build/icon.png ${png.length} bytes`)
  app.quit()
})
