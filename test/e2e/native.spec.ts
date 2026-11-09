import { expect, test, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox, stubOpenDialog } from './launch'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const click = (app: ElectronApplication, id: string) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu()!.getMenuItemById(i)!.click(), id)

test('menu accelerators match PLAN §7 and trigger their actions', async () => {
  const fx = createRepoFixture()
  const l = await launchApp(fx.env)
  const { app, win } = l
  try {
    await openRepo(l, fx.work)
    const accel = await app.evaluate(({ Menu }) => {
      const out: Record<string, string> = {}
      const walk = (items: Electron.MenuItem[]) => items.forEach((i) => (i.id && i.accelerator && (out[i.id] = i.accelerator), i.submenu && walk(i.submenu.items)))
      walk(Menu.getApplicationMenu()!.items)
      return out
    })
    expect(accel).toMatchObject({
      'tab:changes': 'CmdOrCtrl+1',
      'tab:history': 'CmdOrCtrl+2',
      'tab:provider': 'CmdOrCtrl+3',
      'repo:selector': 'CmdOrCtrl+T',
      'branch:selector': 'CmdOrCtrl+B',
      'branch:new': 'CmdOrCtrl+Shift+N',
      'repo:open': 'CmdOrCtrl+O',
      'repo:clone': 'CmdOrCtrl+Shift+O',
      'sync:fetch': 'CmdOrCtrl+Shift+F',
      'sync:pull': 'CmdOrCtrl+Shift+L',
      'sync:push': 'CmdOrCtrl+P',
      'status:refresh': 'CmdOrCtrl+R',
      'repo:reveal': 'CmdOrCtrl+Shift+R',
      'repo:editor': 'CmdOrCtrl+Shift+A',
      'repo:terminal': 'CmdOrCtrl+`',
      settings: 'CmdOrCtrl+,'
    })
    expect(await app.evaluate(({ Menu }) => !!Menu.getApplicationMenu()!.getMenuItemById('update:check'))).toBe(true)

    await click(app, 'tab:history')
    await expect(win.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    await click(app, 'tab:changes')
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')

    await click(app, 'repo:selector')
    await expect(win.getByRole('dialog', { name: 'Repositories' })).toBeVisible()
    await win.keyboard.press('Escape')
    await click(app, 'branch:selector')
    await expect(win.getByRole('dialog', { name: 'Branches' })).toBeVisible()
    await win.keyboard.press('Escape')
    await click(app, 'branch:new')
    await expect(win.getByRole('dialog', { name: 'New branch' })).toBeVisible()
    await win.keyboard.press('Escape')
    await click(app, 'settings')
    await expect(win.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await win.keyboard.press('Escape')
    await click(app, 'repo:clone')
    await expect(win.getByRole('dialog', { name: 'Clone repository' })).toBeVisible()
    await win.getByRole('dialog', { name: 'Clone repository' }).getByRole('button', { name: 'Cancel' }).click()
    await stubOpenDialog(app, null)
    await app.evaluate(({ dialog }) => {
      const orig = dialog.showOpenDialog
      dialog.showOpenDialog = ((...a: Parameters<typeof orig>) => ((globalThis as Record<string, unknown>).__opened = true, orig(...a))) as typeof orig
    })
    await click(app, 'repo:open')
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__opened === true)).toBe(true)

    const sha = fx.commitFile('a.txt', 'a\n')
    await click(app, 'sync:push')
    await expect.poll(() => fx.git(['rev-parse', 'main'], fx.remote)).toBe(sha)
    await click(app, 'sync:fetch')
    await click(app, 'sync:pull')
    await expect(win.getByLabel('Toolbar').getByRole('button', { name: 'Fetch origin' })).toBeVisible()

    writeFileSync(path.join(fx.work, 'b.txt'), 'b\n')
    await click(app, 'status:refresh')
    const row = win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'b.txt' })
    await row.click()
    await win.keyboard.press('Space')
    await expect.poll(() => fx.git(['diff', '--cached', '--name-only'])).toBe('b.txt')
    await expect(row.getByRole('checkbox')).toBeChecked() // UI caught up before toggling back
    await win.keyboard.press('Space')
    await expect.poll(() => fx.git(['diff', '--cached', '--name-only'])).toBe('')
    await stubMessageBox(app, 0)
    await win.keyboard.press(`${mod}+Backspace`)
    await expect(row).toHaveCount(0)
  } finally {
    await l.close()
    fx.cleanup()
  }
})

test('theme follows the OS by default', async () => {
  const { app, win, close } = await launchApp()
  try {
    await win.emulateMedia({ colorScheme: null })
    const [source, osDark] = await app.evaluate(({ nativeTheme }) => [nativeTheme.themeSource, nativeTheme.shouldUseDarkColors] as const)
    expect(source).toBe('system')
    expect(await win.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(osDark)
    // An OS appearance change reaches the renderer as a prefers-color-scheme change; the UI restyles live.
    // The root is transparent when native vibrancy/Mica is on, so check the toolbar's --bg-side.
    for (const [colorScheme, bg] of [['dark', 'rgba(22, 28, 34, 0.44)'], ['light', 'rgba(246, 248, 250, 0.5)']] as const) {
      await win.emulateMedia({ colorScheme })
      await expect(win.locator('header[aria-label="Toolbar"]')).toHaveCSS('background-color', bg)
    }
  } finally {
    await close()
  }
})

test('window bounds persist; a second launch focuses the first instance', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  const env = { ...fx.env, MENDEL_E2E_USERDATA: userData }
  let l = await launchApp(env)
  try {
    // Fit the display (macOS CI is 1024×768), or fitBounds rightly moves the window on relaunch.
    const wa = await l.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
    const set = { x: wa.x + 10, y: wa.y + 10, width: Math.min(1000, wa.width - 20), height: Math.min(640, wa.height - 20) }
    await l.app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]!.setBounds(b), set)
    await l.close()
    l = await launchApp(env)
    await l.win.waitForLoadState()
    expect(await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())).toEqual(set)

    // xvfb has no window manager, so minimize is a no-op on Linux CI.
    const wm = process.platform !== 'linux'
    if (wm) {
      await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize())
      await expect.poll(() => l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())).toBe(true)
    }
    const electron = (await import('electron')).default as unknown as string
    const second = spawn(electron, ['out/main/index.js'], { env: { ...env, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'ignore' })
    const code = await new Promise<number | null>((r) => second.on('exit', r))
    expect(code).toBe(0)
    if (wm) await expect.poll(() => l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())).toBe(false)
    expect(await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  } finally {
    await l.close()
    fx.cleanup()
  }
})
