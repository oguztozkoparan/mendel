import { app, BrowserWindow } from 'electron'
import { ASKPASS_SOCKET_ENV, ASKPASS_TOKEN_ENV, requestAnswer, startAskpassServer } from './auth/askpass'
import { git, setGitEnv } from './git/runner'
import { registerIpc } from './ipc'
import { askUser } from './ipc/auth'
import { startUpdater } from './ipc/update'
import log from './log'
import { createMainWindow } from './window'
import { hardenSession, registerAppScheme } from './security'

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
  const e2e = !app.isPackaged && process.env.GITDOCK_E2E_USERDATA
  // Test-only userData dir, never honored in packaged builds (TECH.md §5).
  if (e2e) app.setPath('userData', e2e)
  // e2e: safeStorage must not touch (or prompt for) the developer's real macOS keychain.
  if (e2e) app.commandLine.appendSwitch('use-mock-keychain')

  app.enableSandbox()
  registerAppScheme()

  void app.whenReady().then(async () => {
    hardenSession()
    registerIpc()
    const askpass = await startAskpassServer({
      // Outside packaged builds the executable is plain Electron and needs our main script.
      command: app.isPackaged ? [process.execPath] : [process.execPath, __filename],
      onPrompt: askUser
    }).catch((err: unknown) => (log.error('[askpass] disabled', err), null))
    if (askpass) {
      setGitEnv(askpass.env)
      app.on('will-quit', () => askpass.close())
    }
    // e2e-only seam: lets Playwright drive the real git runner from the main process.
    if (e2e) Object.assign(globalThis, { __gitdockTest: { git } })
    createMainWindow()
    startUpdater()
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createMainWindow())
  })

  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
}
