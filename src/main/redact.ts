// TECH.md §6.5: strip credentials from anything logged or sent to the renderer.
export function redact(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1***@') // greedy: up to the last `@` before the host (S11)
    .replace(/(authorization:\s*)(?:(basic|bearer)\s+)?\S+/gi, (_m, h: string, scheme?: string) => `${h}${scheme ? scheme + ' ' : ''}***`)
    .replace(/((?:access_)?token=)[^&\s]+/gi, '$1***')
}

/** `redact` applied to strings, Error stacks and strings nested in arrays/plain objects (log arguments). */
export function redactDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return redact(v)
  if (v instanceof Error) return redact(v.stack ?? v.message)
  if (depth > 5 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x, depth + 1)]))
}
