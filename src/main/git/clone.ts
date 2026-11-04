import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import type { CloneProgress } from '../../shared/ipc'
import { git } from './runner'

/**
 * Allow https:, ssh:, file: and scp-style `user@host:path` (TECH.md §6.3). Rejects leading `-`
 * (`ssh://-oProxyCommand`), `transport::address` (ext::, fd::) and option-like hosts/users.
 * shortcut: file:// is allowed (local bare remotes, tests); plain http: and git: are not.
 */
export function validateCloneUrl(raw: string): string {
  const url = raw.trim()
  const bad = (why = 'Unsupported repository URL') => new Error(why)
  if (!url || url.startsWith('-') || /[\0-\x1f\x7f]/.test(url) || /^[a-z][a-z0-9+.-]*::/i.test(url)) throw bad()
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase()
  if (scheme) {
    if (!['https', 'ssh', 'file'].includes(scheme)) throw bad(`Unsupported URL scheme: ${scheme}`)
    let u: URL
    try {
      u = new URL(url)
    } catch {
      throw bad()
    }
    if (u.hostname.startsWith('-') || decodeURIComponent(u.username).startsWith('-')) throw bad()
    if (scheme !== 'file' && !u.hostname) throw bad()
    return url
  }
  if (/^[^-@/\s][^@/\s]*@[^-/:\s][^/:\s]*:[^\s]/.test(url)) return url
  throw bad()
}

/** Last "<Phase>: NN%" in a `--progress` stderr chunk. */
export function parseCloneProgress(chunk: string): CloneProgress | null {
  const all = [...chunk.matchAll(/([A-Za-z][A-Za-z ]+):\s+(\d{1,3})%/g)]
  const m = all.at(-1)
  return m ? { phase: m[1]!.trim(), percent: Number(m[2]) } : null
}

/**
 * `git clone` into `dest` (absolute). Refuses a non-empty destination; on failure or cancel removes
 * `dest` if this call created it, so no partial folder is left behind.
 */
export async function cloneRepo(
  url: string,
  dest: string,
  opts: { signal?: AbortSignal; onProgress?: (p: CloneProgress) => void; env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const existed = existsSync(dest)
  if (existed && readdirSync(dest).length > 0) throw new Error(`Destination already exists and is not empty: ${dest}`)
  try {
    await git(['-c', 'protocol.ext.allow=never', 'clone', '--progress', '--', url, dest], {
      cwd: os.homedir(),
      env: opts.env,
      signal: opts.signal,
      onStderr: (c) => {
        const p = parseCloneProgress(c)
        if (p) opts.onProgress?.(p)
      }
    })
  } catch (err) {
    // Only ever deletes the folder this clone created (checked above), never user data.
    if (!existed) await rm(dest, { recursive: true, force: true })
    throw err
  }
}
