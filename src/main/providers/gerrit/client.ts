// Gerrit REST client (PLAN.md §5.5, TECH.md §6.6). Pure: the caller injects fetch (main passes electron's
// net.fetch for the OS cert store + proxy; tests pass node's fetch against the mock server).
import { urlAllowed } from '../../update/feed'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

const MAX_BODY = 20 * 1024 * 1024

/** Read a response body as text, failing once it exceeds `max` bytes. */
export async function readCapped(res: Response, max = MAX_BODY): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('Gerrit response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Validated base URL without trailing slash: https only (loopback http when allowed), no credentials/query. */
export function normalizeBaseUrl(raw: string, allowLoopbackHttp: boolean): string {
  const s = raw.trim().replace(/\/+$/, '').replace(/\/a$/, '')
  if (!urlAllowed(s, allowLoopbackHttp)) throw new Error('Gerrit URL must start with https:// and contain no credentials')
  const u = new URL(s)
  if (u.search || u.hash) throw new Error('Gerrit URL must not contain a query or fragment')
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}
