import { watch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { git } from './git/runner'
import log from './log'

// git internals that churn without changing what the Changes tab shows.
const IGNORED = /^\.git[\\/](objects|logs|lfs)[\\/]|\.lock$/
let current: { root: string; watchers: FSWatcher[]; timer?: NodeJS.Timeout; since?: number } | null = null
const QUIET_MS = 200
/** Under constant churn (builds, generators) still report at least this often instead of never. */
const MAX_WAIT_MS = 1000

/**
 * Top-level dirs to watch recursively on Linux, where recursive fs.watch costs one inotify watch per directory:
 * everything but `node_modules` and git-ignored dirs (build output, venvs), checked once with `git check-ignore`.
 */
export async function linuxWatchDirs(root: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== 'node_modules').map((d) => d.name)
  if (!dirs.length) return []
  const ignored = await git(['check-ignore', '--stdin', '-z'], { cwd: root, env, background: true, okExitCodes: [1], stdin: dirs.map((d) => `${d}/`).join('\0') }).then(
    (r) => new Set(r.stdout.split('\0')),
    () => new Set<string>()
  )
  return dirs.filter((d) => !ignored.has(`${d}/`))
}

/**
 * Watch the repo being viewed (one at a time) and call `onChange` debounced. If watching fails (Linux ENOSPC: inotify
 * watch limit), stop and call `onOff` once; the UI then relies on focus refresh and View → Refresh.
 * shortcut: on Linux, top-level dirs created after the watch starts are not watched recursively until the app restarts.
 */
export function watchRepo(root: string, onChange: () => void, onOff: () => void = () => {}): void {
  if (current?.root === root) return
  current?.watchers.forEach((w) => w.close())
  const c: NonNullable<typeof current> = { root, watchers: [] }
  current = c
  const handler = (prefix: string) => (_ev: string, file: string | null) => {
    if (file && IGNORED.test(prefix + file)) return
    clearTimeout(c.timer)
    c.since ??= Date.now()
    c.timer = setTimeout(() => ((c.since = undefined), onChange()), Math.min(QUIET_MS, c.since + MAX_WAIT_MS - Date.now()))
  }
  const fail = (err: unknown) => {
    if (current !== c) return
    log.warn('[watch] auto-refresh off', err)
    c.watchers.forEach((w) => w.close())
    c.watchers = [] // `current` stays on this root, so status polls don't retry (and warn) every time
    clearTimeout(c.timer)
    onOff()
  }
  const add = (dir: string, recursive: boolean, prefix: string) => {
    const w = watch(dir, { recursive }, handler(prefix))
    w.on('error', fail)
    c.watchers.push(w)
  }
  const start = async () => {
    if (process.platform !== 'linux') return add(root, true, '')
    const dirs = await linuxWatchDirs(root)
    if (current !== c) return
    add(root, false, '')
    for (const d of dirs) add(path.join(root, d), true, `${d}/`)
  }
  start().catch(fail)
}
