// GitHub App sign-in (OAuth device flow) and authenticated API calls. Pure: the caller injects fetch and the
// credential store (main passes net.fetch and providers/credentials; tests pass fakes). Tokens are only ever sent
// to `origins.login` and `origins.api`, and never put in an error message.
import { z } from 'zod'
import { GITHUB_ACCESS_DENIED, GITHUB_AUTH_ERROR, GITHUB_CODE_EXPIRED, GITHUB_NOT_VISIBLE, githubPullSchema, type GithubPulls } from '../../../shared/github'
import type { Credential } from '../credentials'
import { hostOf, readCapped, type Fetch } from '../http'

/** Public id of the "mendel-desktop" GitHub App; device flow needs no client secret. */
export const CLIENT_ID = 'Iv23liekfapPcvye2Ilc'
/** Where the user types the code; opened from here, never from the response's verification_uri. */
export const DEVICE_PAGE = 'https://github.com/login/device'
/** Install page of the app: a user token only reaches repos where the app is installed. */
export const INSTALL_PAGE = 'https://github.com/apps/mendel-desktop/installations/new'
export const GITHUB_ORIGINS = { login: 'https://github.com', api: 'https://api.github.com' }
export type GithubOrigins = typeof GITHUB_ORIGINS

/** Stored as the credential secret (JSON). Expiry instants are epoch ms, absent when the app's tokens do not expire. */
export interface GithubToken {
  access: string
  refresh?: string
  expiresAt?: number
  refreshExpiresAt?: number
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  /** Seconds between polls. */
  interval: number
  /** Epoch ms. */
  expiresAt: number
}

export interface CredentialStore {
  get(host: string): Promise<Credential | null>
  save(host: string, c: Credential): Promise<boolean>
  remove(host: string): void
}

const TIMEOUT_MS = 30_000
const SMALL = 64 * 1024
const oauthError = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/), interval: z.number().int().min(1).max(600).optional() })
const deviceSchema = z.object({ device_code: z.string().min(1).max(512), user_code: z.string().min(1).max(32), expires_in: z.number().int().min(1).max(3600), interval: z.number().int().min(1).max(600).default(5) })
const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096).optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token_expires_in: z.number().int().positive().optional()
})
const storedSchema = z.object({ access: z.string().min(1), refresh: z.string().optional(), expiresAt: z.number().optional(), refreshExpiresAt: z.number().optional() })
const userSchema = z.object({ login: z.string().min(1).max(100) })

const reachError = (err: unknown) => new Error(`Cannot reach GitHub: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`)

function oauthMessage(code: string): string {
  if (code === 'expired_token') return GITHUB_CODE_EXPIRED
  if (code === 'access_denied') return GITHUB_ACCESS_DENIED
  if (code === 'device_flow_disabled') return 'Device sign-in is disabled for this GitHub App'
  return `GitHub sign-in failed (${code})`
}

function toToken(t: z.infer<typeof tokenSchema>, now: number): GithubToken {
  return {
    access: t.access_token,
    ...(t.refresh_token ? { refresh: t.refresh_token } : {}),
    ...(t.expires_in ? { expiresAt: now + t.expires_in * 1000 } : {}),
    ...(t.refresh_token_expires_in ? { refreshExpiresAt: now + t.refresh_token_expires_in * 1000 } : {})
  }
}

/** Waits `ms`, rejecting with 'Sign-in cancelled' when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => (clearTimeout(t), reject(new Error('Sign-in cancelled')))
    const t = setTimeout(() => (signal.removeEventListener('abort', abort), resolve()), ms)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

/** Device flow and token endpoints on the login origin, plus `GET /user`. */
export function githubAuth(fetchFn: Fetch, origins: GithubOrigins = GITHUB_ORIGINS) {
  /** Form POST to the login origin; returns the parsed JSON body (OAuth errors come back as 200 `{ error }`). */
  async function post(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    let res: Response
    try {
      res = await fetchFn(`${origins.login}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      if (signal?.aborted) throw new Error('Sign-in cancelled')
      throw reachError(err)
    }
    const text = await readCapped(res, SMALL)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`GitHub error ${res.status}`)
    }
    if (!res.ok && !oauthError.safeParse(body).success) throw new Error(`GitHub error ${res.status}`)
    return body
  }

  /** A token endpoint answer: the token, or its OAuth `{ error }`. */
  function tokenOrError(body: unknown): GithubToken | z.infer<typeof oauthError> {
    const t = tokenSchema.safeParse(body)
    if (t.success) return toToken(t.data, Date.now())
    const e = oauthError.safeParse(body)
    if (e.success) return e.data
    throw new Error('Unexpected response from GitHub')
  }

  return {
    async requestDeviceCode(): Promise<DeviceCode> {
      const body = await post('/login/device/code', { client_id: CLIENT_ID })
      const e = oauthError.safeParse(body)
      if (e.success) throw new Error(oauthMessage(e.data.error))
      const d = deviceSchema.safeParse(body)
      if (!d.success) throw new Error('Unexpected response from GitHub')
      return { deviceCode: d.data.device_code, userCode: d.data.user_code, interval: d.data.interval, expiresAt: Date.now() + d.data.expires_in * 1000 }
    },

    /** Polls until the user authorizes (never faster than the interval; slow_down raises it). Abort `signal` to stop. */
    async pollToken(dc: DeviceCode, signal: AbortSignal): Promise<GithubToken> {
      let interval = dc.interval
      for (;;) {
        await sleep(interval * 1000, signal)
        if (Date.now() >= dc.expiresAt) throw new Error(GITHUB_CODE_EXPIRED)
        const r = tokenOrError(await post('/login/oauth/access_token', { client_id: CLIENT_ID, device_code: dc.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, signal))
        if ('access' in r) return r
        if (r.error === 'authorization_pending') continue
        if (r.error === 'slow_down') interval = r.interval ?? interval + 5
        else throw new Error(oauthMessage(r.error))
      }
    },

    /** Trades the single-use refresh token for a new pair (no client secret for device-flow tokens). Only an OAuth `{ error }` throws other than "Cannot reach GitHub". */
    async refresh(refreshToken: string): Promise<GithubToken> {
      let r: ReturnType<typeof tokenOrError>
      try {
        r = tokenOrError(await post('/login/oauth/access_token', { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }))
      } catch (err) {
        // 5xx, non-JSON, unexpected JSON: GitHub did not refuse the token, so report it like a network failure
        throw err instanceof Error && err.message.startsWith('Cannot reach GitHub') ? err : reachError(err)
      }
      if ('access' in r) return r
      throw new Error(oauthMessage(r.error))
    },

    /** `GET <api><path>` with the token; the raw Response (status unchecked) for the caller to judge. */
    async get(access: string, path: string): Promise<Response> {
      try {
        return await fetchFn(`${origins.api}${path}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${access}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          redirect: 'error', // never replay the Authorization header elsewhere
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch (err) {
        throw reachError(err)
      }
    }
  }
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** Error text of a failed API answer, in order: auth, rate limits (primary, secondary), then `repoScoped` 403/404 → GITHUB_NOT_VISIBLE. */
function apiError(res: Response, text: string, repoScoped: boolean): string {
  const st = res.status
  if (st === 401) return GITHUB_AUTH_ERROR
  const limited = st === 403 || st === 429
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  if (limited && res.headers.get('x-ratelimit-remaining') === '0' && reset > 0) return `Rate limited until ${hhmm(reset * 1000)}`
  const retry = Number(res.headers.get('retry-after'))
  if (limited && retry > 0) return `Rate limited, retry in ${Math.ceil(retry)} s`
  if (limited && /rate limit/i.test(text)) return 'Rate limited, try again in a minute'
  if (repoScoped && (st === 403 || st === 404)) return GITHUB_NOT_VISIBLE
  return `GitHub error ${st}`
}

/** Parses a JSON API answer with `schema`; failures as `apiError`. */
async function parseApi<T>(res: Response, schema: z.ZodType<T>, path: string, repoScoped = false): Promise<T> {
  const text = await readCapped(res)
  if (!res.ok) throw new Error(apiError(res, text, repoScoped))
  try {
    return schema.parse(JSON.parse(text))
  } catch {
    throw new Error(`Unexpected response from GitHub for ${path.split('?')[0]}`)
  }
}

/**
 * Signed-in state for one API host: sign-in result storage, and API GETs that refresh the token when it is about to
 * expire or GitHub answers 401 once. Refreshes are serialized: the refresh token is single-use.
 */
export function githubSession(fetchFn: Fetch, store: CredentialStore, origins: GithubOrigins = GITHUB_ORIGINS) {
  const auth = githubAuth(fetchFn, origins)
  const host = hostOf(origins.api)
  let refreshing: Promise<GithubToken> | null = null

  async function load(): Promise<{ login: string; token: GithubToken }> {
    const c = await store.get(host)
    if (!c) throw new Error(GITHUB_AUTH_ERROR)
    try {
      return { login: c.username, token: storedSchema.parse(JSON.parse(c.password)) }
    } catch {
      store.remove(host)
      throw new Error(GITHUB_AUTH_ERROR)
    }
  }

  function refresh(stale: GithubToken): Promise<GithubToken> {
    refreshing ??= (async () => {
      const { login, token } = await load()
      if (token.access !== stale.access) return token // someone else already rotated it
      if (!token.refresh || (token.refreshExpiresAt && token.refreshExpiresAt <= Date.now())) {
        store.remove(host)
        throw new Error(GITHUB_AUTH_ERROR)
      }
      let next: GithubToken
      try {
        next = await auth.refresh(token.refresh)
      } catch (err) {
        // Unreachable or no OAuth answer: the token may still be unused, keep it. GitHub said no: it is gone for good.
        if (err instanceof Error && err.message.startsWith('Cannot reach GitHub')) throw err
        store.remove(host)
        throw new Error(GITHUB_AUTH_ERROR)
      }
      await store.save(host, { username: login, password: JSON.stringify(next) })
      return next
    })().finally(() => (refreshing = null))
    return refreshing
  }

  /** Authenticated `GET <api><path>`, refreshing the token when it expires soon or on one 401 (GITHUB_AUTH_ERROR when that fails); the raw Response. */
  async function request(path: string): Promise<Response> {
    if (refreshing) await refreshing.catch(() => {})
    let { token } = await load()
    if (token.expiresAt && token.expiresAt - Date.now() < 60_000) token = await refresh(token)
    let res = await auth.get(token.access, path)
    if (res.status === 401) {
      await res.body?.cancel()
      token = await refresh(token)
      res = await auth.get(token.access, path)
      if (res.status === 401) {
        await res.body?.cancel()
        store.remove(host)
        throw new Error(GITHUB_AUTH_ERROR)
      }
    }
    return res
  }

  return {
    host,
    /** Learns the login with the new token and stores both; returns whether it persisted (false = this session only). */
    async save(token: GithubToken): Promise<{ login: string; persisted: boolean }> {
      const { login } = await parseApi(await auth.get(token.access, '/user'), userSchema, '/user')
      return { login, persisted: await store.save(host, { username: login, password: JSON.stringify(token) }) }
    },

    /** Authenticated `GET <api><path>` parsed with `schema`; throws GITHUB_AUTH_ERROR (credential removed) when sign-in is needed again. */
    async api<T>(schema: z.ZodType<T>, path: string): Promise<T> {
      return parseApi(await request(path), schema, path)
    },

    /** First page (50) of the open pull requests of `project` ('owner/repo'). */
    async pulls(project: string): Promise<GithubPulls> {
      const path = `/repos/${project.split('/').map(encodeURIComponent).join('/')}/pulls?state=open&per_page=50`
      const res = await request(path)
      const pulls = await parseApi(res, z.array(githubPullSchema), path, true)
      return { pulls, more: /rel="next"/.test(res.headers.get('link') ?? '') }
    }
  }
}
