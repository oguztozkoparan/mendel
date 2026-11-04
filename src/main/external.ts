// Open a repo/file in the user's editor or terminal (PLAN.md §3.5, §6). Always spawn(absolute exe, argv array) or
// shell.openPath: never a shell string. Targets are absolute paths main resolved itself (resolveUnder).
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import type { ExternalTool } from '../shared/ipc'
import { isExecutableFile } from './git/runner'
import { getSettings } from './settings'

type Kind = 'editor' | 'terminal'
/** `app`: a macOS .app bundle (opened with `open -a`); else an executable. `args(target)` = fixed argv. */
interface Tool extends ExternalTool {
  exe: string
  app?: boolean
  args?: (target: string) => string[]
}

const MAC: Record<Kind, [string, string][]> = {
  editor: [['vscode', 'Visual Studio Code'], ['cursor', 'Cursor'], ['windsurf', 'Windsurf'], ['zed', 'Zed'], ['sublime', 'Sublime Text'], ['idea', 'IntelliJ IDEA'], ['idea-ce', 'IntelliJ IDEA CE'], ['webstorm', 'WebStorm'], ['bbedit', 'BBEdit'], ['nova', 'Nova']],
  terminal: [['terminal', 'Terminal'], ['iterm', 'iTerm'], ['warp', 'Warp'], ['ghostty', 'Ghostty'], ['kitty', 'kitty'], ['alacritty', 'Alacritty'], ['wezterm', 'WezTerm']]
}
const LINUX: Record<Kind, [string, string][]> = {
  editor: [['vscode', 'code'], ['cursor', 'cursor'], ['zed', 'zed'], ['sublime', 'subl'], ['gedit', 'gedit'], ['kate', 'kate']],
  terminal: [['gnome-terminal', 'gnome-terminal'], ['konsole', 'konsole'], ['xfce4-terminal', 'xfce4-terminal'], ['kitty', 'kitty'], ['alacritty', 'alacritty'], ['wezterm', 'wezterm'], ['xterm', 'xterm'], ['x-terminal-emulator', 'x-terminal-emulator']]
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()
const onPath = (name: string) =>
  (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, name)).find((p) => path.isAbsolute(p) && isExecutableFile(p))

/** Installed editors/terminals for this OS (checked on each call: cheap fs stats). */
export function detectTools(kind: Kind): Tool[] {
  if (process.platform === 'darwin') {
    const dirs = ['/Applications', '/System/Applications/Utilities', path.join(os.homedir(), 'Applications')]
    return MAC[kind].flatMap(([id, name]) => {
      const exe = dirs.map((d) => path.join(d, `${name}.app`)).find(isDir)
      return exe ? [{ id, name, exe, app: true }] : []
    })
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? ''
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
    const sys = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    const all: Record<Kind, Tool[]> = {
      editor: [
        { id: 'vscode', name: 'Visual Studio Code', exe: path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe') },
        { id: 'vscode-system', name: 'Visual Studio Code', exe: path.join(pf, 'Microsoft VS Code', 'Code.exe') },
        { id: 'cursor', name: 'Cursor', exe: path.join(local, 'Programs', 'cursor', 'Cursor.exe') },
        { id: 'sublime', name: 'Sublime Text', exe: path.join(pf, 'Sublime Text', 'sublime_text.exe') },
        { id: 'notepad++', name: 'Notepad++', exe: path.join(pf, 'Notepad++', 'notepad++.exe') }
      ],
      terminal: [
        { id: 'wt', name: 'Windows Terminal', exe: path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe'), args: (dir) => ['-d', dir] },
        { id: 'powershell', name: 'PowerShell', exe: path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe') },
        { id: 'cmd', name: 'Command Prompt', exe: path.join(sys, 'cmd.exe') }
      ]
    }
    return all[kind].filter((t) => path.isAbsolute(t.exe) && isExecutableFile(t.exe))
  }
  return LINUX[kind].flatMap(([id, bin]) => {
    const exe = onPath(bin)
    return exe ? [{ id, name: bin, exe }] : []
  })
}

/** A user-picked custom tool: an absolute executable (or .app on macOS); args are fixed, never a command line. */
export function validCustomTool(p: string): boolean {
  if (!path.isAbsolute(p) || p.includes('\0')) return false
  return process.platform === 'darwin' && p.endsWith('.app') ? isDir(p) : isExecutableFile(p)
}

function launch(t: Tool, target: string, cwd: string, withTarget: boolean): Promise<void> {
  const [exe, args] = t.app ? ['/usr/bin/open', ['-a', t.exe, target]] : [t.exe, withTarget ? (t.args?.(target) ?? [target]) : (t.args?.(target) ?? [])]
  return new Promise((resolve, reject) => {
    // detached: the tool outlives gitdock and (Windows) gets its own console window.
    const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', shell: false })
    child.once('error', (e) => reject(new Error(`Could not start ${t.name}: ${e.message}`)))
    child.once('spawn', () => (child.unref(), resolve()))
  })
}

function chosen(kind: Kind): Tool | null {
  const s = getSettings()
  const [id, custom] = kind === 'editor' ? [s.editor, s.editorPath] : [s.terminal, s.terminalPath]
  if (id === 'custom') {
    if (!validCustomTool(custom)) throw new Error(`The custom ${kind} is no longer an executable: ${custom || '(none)'}`)
    return { id, name: path.basename(custom), exe: custom, app: process.platform === 'darwin' && custom.endsWith('.app') }
  }
  // An id that is no longer installed falls back to the system default.
  return detectTools(kind).find((t) => t.id === id) ?? null
}

/** Open an absolute file or folder in the chosen editor; "System default" = the OS file association. */
export async function openInEditor(abs: string): Promise<void> {
  const t = chosen('editor')
  if (t) return launch(t, abs, isDir(abs) ? abs : path.dirname(abs), true)
  const err = await shell.openPath(abs)
  if (err) throw new Error(err)
}

/** Open the chosen terminal in folder `dir`; "System default" = Terminal.app / cmd.exe / the first detected one. */
export async function openTerminal(dir: string): Promise<void> {
  const found = detectTools('terminal')
  const t = chosen('terminal') ?? found.find((x) => x.id === 'x-terminal-emulator') ?? found[0]
  if (!t) throw new Error('No terminal found. Choose one in Settings → General.')
  return launch(t, dir, dir, false)
}
