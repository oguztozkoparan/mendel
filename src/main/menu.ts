import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { checkForUpdates } from './ipc/update'

const send = (cmd: MenuCommand) => (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents.send('menu:command', cmd)
/** A menu item that asks the renderer to run `cmd`; its id is the command (tests click items by id). */
const item = (label: string, cmd: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({ id: cmd, label, accelerator, click: () => send(cmd) })

/** Native menu bar with the PLAN.md §7 accelerators (`CmdOrCtrl` = Mod). */
export function buildMenu(): void {
  const mac = process.platform === 'darwin'
  const updates: MenuItemConstructorOptions = { id: 'update:check', label: 'Check for Updates…', click: checkForUpdates }
  const settings = item(mac ? 'Settings…' : 'Settings', 'settings', 'CmdOrCtrl+,')
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              updates,
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('Open Local Repository…', 'repo:open', 'CmdOrCtrl+O'),
        item('Clone Repository…', 'repo:clone', 'CmdOrCtrl+Shift+O'),
        { type: 'separator' },
        ...(mac ? [] : [settings, { type: 'separator' } as const]),
        mac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        item('Changes', 'tab:changes', 'CmdOrCtrl+1'),
        item('History', 'tab:history', 'CmdOrCtrl+2'),
        item('Provider Tab', 'tab:provider', 'CmdOrCtrl+3'),
        { type: 'separator' },
        item('Refresh', 'status:refresh', 'CmdOrCtrl+R'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const])
      ]
    },
    {
      label: 'Repository',
      submenu: [
        item('Repositories…', 'repo:selector', 'CmdOrCtrl+T'),
        { type: 'separator' },
        item('Fetch', 'sync:fetch', 'CmdOrCtrl+Shift+F'),
        item('Pull', 'sync:pull', 'CmdOrCtrl+Shift+L'),
        item('Push', 'sync:push', 'CmdOrCtrl+P'),
        item('Rebase onto Upstream', 'sync:rebase'),
        { type: 'separator' },
        item(mac ? 'Reveal in Finder' : 'Show in File Manager', 'repo:reveal', 'CmdOrCtrl+Shift+R')
      ]
    },
    {
      label: 'Branch',
      submenu: [item('Branches…', 'branch:selector', 'CmdOrCtrl+B'), item('New Branch…', 'branch:new', 'CmdOrCtrl+Shift+N')]
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: mac ? [] : [{ role: 'about' }, updates] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
