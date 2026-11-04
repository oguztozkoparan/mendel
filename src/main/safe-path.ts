import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** Resolve untrusted relative `rel` under `root`; null if it escapes root, is absolute or has NUL. */
export function resolveUnder(root: string, rel: string): string | null {
  if (rel.includes('\0') || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return null
  const abs = path.resolve(root, rel)
  const r = path.relative(root, abs)
  return r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r) ? null : abs
}

/** `rel` is under `root` after resolving symlinks in its parent dirs (TECH.md §6.4); a symlink leaf itself is allowed. */
export async function realUnder(root: string, rel: string): Promise<boolean> {
  const abs = resolveUnder(root, rel)
  if (!abs) return false
  try {
    const [r, dir] = await Promise.all([realpath(root), realpath(path.dirname(abs))])
    return resolveUnder(r, path.relative(r, dir)) !== null
  } catch {
    return false
  }
}
