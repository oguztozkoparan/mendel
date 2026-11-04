import { watch, type FSWatcher } from 'node:fs'
import log from './log'

// git internals that churn without changing what the Changes tab shows.
const IGNORED = /^\.git[\\/](objects|logs|lfs)[\\/]|\.lock$/
let current: { root: string; watcher: FSWatcher; timer?: NodeJS.Timeout; since?: number } | null = null
const QUIET_MS = 200
/** Under constant churn (builds, generators) still report at least this often instead of never. */
const MAX_WAIT_MS = 1000

/**
 * Watch the repo being viewed (one at a time, recursive) and call `onChange` debounced.
 * shortcut: recursive fs.watch on Linux sets one inotify watch per dir; huge trees may hit limits, then we rely on focus refresh.
 */
export function watchRepo(root: string, onChange: () => void): void {
  if (current?.root === root) return
  current?.watcher.close()
  const c: NonNullable<typeof current> = {
    root,
    watcher: watch(root, { recursive: true }, (_ev, file) => {
      if (file && IGNORED.test(file)) return
      clearTimeout(c.timer)
      c.since ??= Date.now()
      c.timer = setTimeout(() => ((c.since = undefined), onChange()), Math.min(QUIET_MS, c.since + MAX_WAIT_MS - Date.now()))
    })
  }
  c.watcher.on('error', (err) => log.warn('[watch]', err))
  current = c
}
