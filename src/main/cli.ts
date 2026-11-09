// `mendel .` launcher: a repo path on the command line (first launch or second-instance argv) opens that repo.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { emit } from './ipc'
import { topLevelTrusting } from './ipc/repo'
import log from './log'
import { rememberRepo } from './repos'

/** Path argument from `argv`, absolute against the caller's `cwd`; null if none. Switches (Chromium's, macOS `-psn_`) are skipped. */
export function cliPath(argv: string[], cwd: string, defaultApp = !!process.defaultApp): string | null {
  // Unpackaged runs are `electron <main script> ...`; packaged ones `<exe> ...`.
  const arg = argv
    .slice(defaultApp ? 2 : 1)
    .filter((a) => !a.startsWith('-'))
    .at(-1)
  return arg && !arg.includes('\0') ? path.resolve(cwd, arg) : null
}

/** Open the repo named in `argv` (validated by git as a work tree, S16 trust prompt included) and make it current. */
export async function openCliRepo(argv: string[], cwd: string): Promise<void> {
  const dir = cliPath(argv, cwd)
  if (!dir) return
  try {
    const r = rememberRepo(await topLevelTrusting(dir, BrowserWindow.getAllWindows()[0] ?? null))
    emit('repo:opened', { repo: r.id })
  } catch (err) {
    log.warn('[cli] not opened', dir, err)
    dialog.showErrorBox('Cannot open repository', `${dir}\n\n${err instanceof Error ? err.message : String(err)}`)
  }
}

const MARK = '# Installed by Mendel'
const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

/** POSIX sh launcher: resolves the dir in the caller's shell and starts `command` detached (no shell string reaches main). */
export function cliScript(command: string[]): string {
  return `#!/bin/sh\n${MARK}: usage \`mendel [dir]\` opens dir (default .) in Mendel.\ndir=$(cd "\${1:-.}" && pwd) || exit 1\nnohup ${command.map(quote).join(' ')} -- "$dir" >/dev/null 2>&1 &\n`
}

/** Menu action (macOS/Linux): write the `mendel` script to ~/.local/bin, user-writable so never sudo. Windows: not offered. */
export async function installCli(): Promise<void> {
  const bin = path.join(os.homedir(), '.local', 'bin')
  const file = path.join(bin, 'mendel')
  const command = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]
  try {
    mkdirSync(bin, { recursive: true })
    if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARK)) throw new Error(`${file} already exists and was not installed by Mendel.`)
    rmSync(file, { force: true }) // replace the entry itself, never write through a symlink
    writeFileSync(file, cliScript(command), { mode: 0o755, flag: 'wx' })
    const onPath = (process.env.PATH ?? '').split(path.delimiter).includes(bin)
    await dialog.showMessageBox({
      message: 'Installed the mendel command',
      detail: `${file}\n\nRun \`mendel .\` in a repository to open it here.${onPath ? '' : `\n\n${bin} is not on your PATH: add it in your shell profile.`}`
    })
  } catch (err) {
    dialog.showErrorBox('Could not install the mendel command', err instanceof Error ? err.message : String(err))
  }
}
