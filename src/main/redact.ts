// TECH.md §6.5: strip credentials from anything logged or sent to the renderer.
export function redact(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
    .replace(/(authorization:\s*)(?:(basic|bearer)\s+)?\S+/gi, (_m, h: string, scheme?: string) => `${h}${scheme ? scheme + ' ' : ''}***`)
    .replace(/((?:access_)?token=)[^&\s]+/gi, '$1***')
}
