// Packaged GUI apps on macOS/Linux start with launchd's/the desktop's minimal PATH, so a Homebrew git, git-lfs or
// credential helper the terminal finds would be missing. Read the login shell's PATH once at startup and merge it in.
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const MARK = '__GITDOCK_PATH__'

/** Login-shell entries first (terminal order), then current entries it lacks; empty and duplicate dirs dropped. */
export function mergePath(current: string | undefined, login: string | null): string {
  const dirs = [...(login ?? '').split(path.delimiter), ...(current ?? '').split(path.delimiter)].filter(Boolean)
  return [...new Set(dirs)].join(path.delimiter)
}

/** `$SHELL -ilc` PATH between markers (rc files may print banners), or null on failure/timeout. */
export function loginShellPath(shell = process.env.SHELL || os.userInfo().shell || '/bin/sh', env = process.env, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], { env, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) =>
      resolve(err ? null : (new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(stdout)?.[1] ?? null))
    )
    child.stdin?.end() // an interactive shell must not wait on our stdin
  })
}

/** Merge the login-shell PATH into process.env (git runs and findGit read it); no-op on Windows. */
export async function applyLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  process.env.PATH = mergePath(process.env.PATH, await loginShellPath())
}
