import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import { ASKPASS_SOCKET_ENV, ASKPASS_TOKEN_ENV, requestAnswer, startAskpassServer } from './auth/askpass'
import { git, killAllGit, setGitEnv } from './git/runner'
import { registerIpc } from './ipc'
import { askUser } from './ipc/auth'
import { startUpdater } from './ipc/update'
import log from './log'
import { clearCurrent } from './repos'
import { getSettings, onSettingsChanged } from './settings'
import { applyLoginShellPath } from './shell-path'
import { buildMenu } from './menu'
import { createMainWindow } from './window'
import { hardenSession, registerAppScheme, testSeams } from './security'

// P2: no debugger/CDP attach to a release build (fuses already block Node's --inspect; this covers Chromium's switches).
// Chromium also takes `-x` and (Windows) `/x`, case-insensitively: ask its own parser, plus a broad argv match.
const debugSwitches = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'inspect', 'inspect-brk', 'inspect-port']
if (!testSeams && (debugSwitches.some((s) => app.commandLine.hasSwitch(s)) || process.argv.some((a) => /^(--?|\/)(remote-debugging-|inspect)/i.test(a)))) process.exit(1)
if (process.env[ASKPASS_TOKEN_ENV]) void runAskpass()
else startApp()

/** We were started by git/ssh as GIT_ASKPASS/SSH_ASKPASS: relay the prompt (last argv) to the running app. */
async function runAskpass(): Promise<void> {
  app.dock?.hide()
  const answer = await requestAnswer(process.env[ASKPASS_SOCKET_ENV] ?? '', process.env[ASKPASS_TOKEN_ENV] ?? '', process.argv.at(-1) ?? '')
  // Electron ignores exit codes before `ready`; a lost non-zero code would make git read "" as the answer.
  await app.whenReady()
  if (answer === null) return app.exit(1)
  process.stdout.write(answer + '\n', () => app.exit(0))
}

function startApp(): void {
  const e2e = testSeams && process.env.MENDEL_E2E_USERDATA
  // Test-only userData dir, compiled out of release builds (S13, TECH.md §5).
  if (e2e) app.setPath('userData', e2e)
  // e2e: safeStorage must not touch (or prompt for) the developer's real macOS keychain.
  if (e2e) app.commandLine.appendSwitch('use-mock-keychain')
  // Second launch: hand over to the running instance (keyed by userData) and quit.
  if (!app.requestSingleInstanceLock()) return app.quit()
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return void (app.isReady() && createMainWindow())
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.enableSandbox()
  registerAppScheme()
  // Dev/e2e inherit the terminal's PATH; only packaged launches (Finder, desktop) need the login shell's.
  const shellPath = app.isPackaged ? applyLoginShellPath().catch((err: unknown) => log.warn('[path] login shell PATH unavailable', err)) : null

  void app.whenReady().then(async () => {
    await shellPath // before git is first resolved
    // Packaged builds get the icon from the bundle; dev runs would show Electron's.
    if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '../../build/icon.png'))
    hardenSession()
    registerIpc()
    if (!getSettings().reopenLastRepo) clearCurrent()
    nativeTheme.themeSource = getSettings().theme
    onSettingsChanged((s) => (nativeTheme.themeSource = s.theme))
    const askpass = await startAskpassServer({
      // Outside packaged builds the executable is plain Electron and needs our main script.
      command: app.isPackaged ? [process.execPath] : [process.execPath, __filename],
      onPrompt: askUser
    }).catch((err: unknown) => (log.error('[askpass] disabled', err), null))
    if (askpass) {
      setGitEnv(askpass.issue)
      app.on('will-quit', () => askpass.close())
    }
    // e2e-only seam: lets Playwright drive the real git runner from the main process.
    if (e2e) Object.assign(globalThis, { __mendelTest: { git } })
    buildMenu()
    createMainWindow()
    startUpdater()
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
  })

  app.on('will-quit', killAllGit)
  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
}
