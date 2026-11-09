// `mendel .` launcher: a repo path on the command line (first launch or second-instance argv) opens that repo.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { emit } from './ipc'
import { topLevelTrusting } from './ipc/repo'
import log from './log'
import { rememberRepo } from './repos'

/** Path argument from `argv`, absolute against the caller's `cwd`; null if none. */
export function cliPath(argv: string[], cwd: string, defaultApp = !!process.defaultApp): string | null {
  // Rule: the arg after `--` is the path (the installed script's form). Otherwise only the last arg, if it is not a
  // switch, not the exe / main script (switches dropped before skipping: Chromium inserts its own before the main
  // script in second-instance argv), not the value of a preceding switch without `=` (macOS `-AppleLanguages (en)`,
  // `--user-data-dir /p`), and it exists, so a stray switch value never pops an error box at launch.
  const sep = argv.indexOf('--')
  const arg = sep >= 0 ? argv[sep + 1] : argv.at(-1)
  if (!arg || arg.includes('\0')) return null
  if (sep >= 0) return path.resolve(cwd, arg)
  const prev = argv.at(-2)
  const positional = argv.filter((a) => !a.startsWith('-')).slice(defaultApp ? 2 : 1)
  if (positional.at(-1) !== arg || (prev?.startsWith('-') && !prev.includes('='))) return null
  const dir = path.resolve(cwd, arg)
  return existsSync(dir) ? dir : null
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
  return `#!/bin/sh\n${MARK}: usage \`mendel [dir]\` opens dir (default .) in Mendel.\ndir=$(cd -P -- "\${1:-.}" >/dev/null && pwd) || exit 1\nnohup ${command.map(quote).join(' ')} -- "$dir" >/dev/null 2>&1 &\n`
}

/** Menu action (macOS/Linux): write the `mendel` script to ~/.local/bin, user-writable so never sudo. Windows: not offered. */
export async function installCli(): Promise<void> {
  const bin = path.join(os.homedir(), '.local', 'bin')
  const file = path.join(bin, 'mendel')
  // AppImage: execPath is under /tmp/.mount_*, gone after quit; APPIMAGE is the real file.
  const exe = process.env.APPIMAGE || process.execPath
  const command = app.isPackaged ? [exe] : [exe, app.getAppPath()]
  try {
    if (exe.includes('/AppTranslocation/')) throw new Error('Mendel is running from a temporary (translocated) location. Move Mendel to /Applications, open it from there, then install the command again.')
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
