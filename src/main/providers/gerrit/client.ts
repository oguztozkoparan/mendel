// Gerrit REST client (PLAN.md §5.5, TECH.md §6.6). Pure: the caller injects fetch (main passes electron's
// net.fetch for the OS cert store + proxy; tests pass node's fetch against the mock server).
import type { z } from 'zod'
import { accountSchema, GERRIT_AUTH_ERROR } from '../../../shared/gerrit'
import { urlAllowed } from '../../update/feed'
import { XSSI } from './detect'

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

export interface GerritAuth {
  username: string
  /** HTTP password or (3.13+) access token: both are sent as Basic auth. */
  password: string
}

export class GerritHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** Strip the `)]}'` XSSI prefix (only at offset 0), then JSON.parse. */
export function parseGerritJson(body: string): unknown {
  return JSON.parse(body.startsWith(XSSI) ? body.slice(XSSI.length) : body)
}

/** REST calls under `<baseUrl>/a/` with Basic auth. `path` segments must already be URL-encoded (see `enc`). */
export function gerritClient(baseUrl: string, auth: GerritAuth, fetchFn: Fetch) {
  const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64')

  async function call<T>(schema: z.ZodType<T>, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchFn(`${baseUrl}/a/${path}`, {
        method,
        headers: { Authorization: authHeader, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error', // never replay the Authorization header elsewhere
        signal: AbortSignal.timeout(30_000)
      })
    } catch (err) {
      throw new Error(`Cannot reach Gerrit at ${baseUrl}: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`)
    }
    const text = await readCapped(res)
    if (res.status === 401) throw new GerritHttpError(401, GERRIT_AUTH_ERROR)
    if (!res.ok) throw new GerritHttpError(res.status, `Gerrit error ${res.status}: ${text.trim().split('\n')[0].slice(0, 300) || res.statusText}`)
    try {
      return schema.parse(parseGerritJson(text))
    } catch {
      throw new Error(`Unexpected response from Gerrit for ${method} ${path.split('?')[0]}`)
    }
  }

  return {
    self: () => call(accountSchema, 'GET', 'accounts/self')
  }
}

/** Encode one path segment (change id, revision, file path: `/` becomes %2F as Gerrit expects). */
export const enc = (s: string | number): string => encodeURIComponent(String(s))

/** Validated base URL without trailing slash: https only (loopback http when allowed), no credentials/query. */
export function normalizeBaseUrl(raw: string, allowLoopbackHttp: boolean): string {
  const s = raw.trim().replace(/\/+$/, '').replace(/\/a$/, '')
  if (!urlAllowed(s, allowLoopbackHttp)) throw new Error('Gerrit URL must start with https:// and contain no credentials')
  const u = new URL(s)
  if (u.search || u.hash) throw new Error('Gerrit URL must not contain a query or fragment')
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}
