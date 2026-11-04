import path from 'node:path'

/** Resolve untrusted relative `rel` under `root`; null if it escapes root, is absolute or has NUL. */
export function resolveUnder(root: string, rel: string): string | null {
  if (rel.includes('\0') || path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return null
  const abs = path.resolve(root, rel)
  const r = path.relative(root, abs)
  return r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r) ? null : abs
}
