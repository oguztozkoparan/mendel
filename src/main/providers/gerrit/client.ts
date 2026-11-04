// Gerrit REST client (PLAN.md §5.5, TECH.md §6.6). Pure: the caller injects fetch (main passes electron's
// net.fetch for the OS cert store + proxy; tests pass node's fetch against the mock server).
import { z } from 'zod'
import { accountSchema, changeSchema, commentSchema, diffSchema, fileSchema, GERRIT_AUTH_ERROR, type GerritChangeLists, type GerritComment, type GerritDraft } from '../../../shared/gerrit'
import { urlAllowed } from '../../update/feed'
import { XSSI } from './detect'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

const MAX_BODY = 20 * 1024 * 1024
/** Change-Id lookups only decorate UI (badges, hints): give up fast instead of holding the commit list back. */
export const HINT_TIMEOUT_MS = 3000

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

  async function call<T>(schema: z.ZodType<T>, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response
    try {
      res = await fetchFn(`${baseUrl}/a/${path}`, {
        method,
        headers: { Authorization: authHeader, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error', // never replay the Authorization header elsewhere
        signal: AbortSignal.timeout(timeoutMs)
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
    self: () => call(accountSchema, 'GET', 'accounts/self'),

    /** Outgoing / Incoming / Recently closed (last 10) in one request (PLAN.md §3.7, §5.5). */
    async listChanges(project: string | null): Promise<GerritChangeLists> {
      const p = project ? ` project:"${project}"` : ''
      const qs = [`status:open owner:self${p}`, `status:open reviewer:self -owner:self${p}`, `owner:self -is:open limit:10${p}`]
      const q = qs.map((x) => 'q=' + encodeURIComponent(x)).join('&')
      const [outgoing, incoming, closed] = await call(z.array(z.array(changeSchema)).length(3), 'GET', `changes/?${q}&o=LABELS&o=DETAILED_ACCOUNTS`)
      return { outgoing, incoming, closed }
    },

    /** Open changes whose Change-Id is one of `ids` (History badges, new-patchset hint), optionally in `project`. */
    openChanges: (ids: string[], project: string | null) =>
      call(z.array(changeSchema), 'GET', `changes/?q=${encodeURIComponent(`status:open (${ids.map((i) => `change:${i}`).join(' OR ')})${project ? ` project:"${project}"` : ''}`)}`, undefined, HINT_TIMEOUT_MS),

    change: (n: number) =>
      call(changeSchema, 'GET', `changes/${enc(n)}/detail?o=CURRENT_REVISION&o=ALL_REVISIONS&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS&o=CURRENT_ACTIONS&o=MESSAGES`),

    /** Files of `rev` (sha, patch set number or "current"), against patch set `base` or the parent. */
    files: (n: number, rev: string, base?: number) =>
      call(z.record(z.string(), fileSchema), 'GET', `changes/${enc(n)}/revisions/${enc(rev)}/files${base ? `?base=${enc(base)}` : ''}`),

    /** All published comments, flattened with their path. */
    async comments(n: number): Promise<GerritComment[]> {
      const map = await call(z.record(z.string(), z.array(commentSchema)), 'GET', `changes/${enc(n)}/comments`)
      return Object.entries(map).flatMap(([path, list]) => list.map((c) => ({ ...c, path })))
    },

    /** `POST …/revisions/<rev>/review` with message, votes and inline comments in one call. */
    review: (n: number, rev: string | number, input: { message?: string; labels?: Record<string, number>; comments?: Record<string, Omit<GerritDraft, 'path' | 'patch_set'>[]> }) =>
      call(z.object({ labels: z.record(z.string(), z.number()).optional() }), 'POST', `changes/${enc(n)}/revisions/${enc(rev)}/review`, input),

    /** Change-level POST: submit, abandon (optional message) or server-side rebase. */
    action: (n: number, action: 'submit' | 'abandon' | 'rebase', message?: string) =>
      call(z.unknown(), 'POST', `changes/${enc(n)}/${action}`, message ? { message } : {}),

    diff: (n: number, rev: string, path: string, base?: number) =>
      call(diffSchema, 'GET', `changes/${enc(n)}/revisions/${enc(rev)}/files/${enc(path)}/diff?intraline=false${base ? `&base=${enc(base)}` : ''}`)
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
