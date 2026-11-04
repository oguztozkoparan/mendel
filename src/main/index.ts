import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow } from './window'
import { hardenSession, registerAppScheme } from './security'

// Test-only userData dir, never honored in packaged builds (TECH.md §5).
if (!app.isPackaged && process.env.GITDOCK_E2E_USERDATA) app.setPath('userData', process.env.GITDOCK_E2E_USERDATA)

app.enableSandbox()
registerAppScheme()

void app.whenReady().then(() => {
  hardenSession()
  registerIpc()
  createMainWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
})

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
