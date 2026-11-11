import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CLIENT_ID, githubAuth, githubSession, type CredentialStore, type GithubToken } from '../../src/main/providers/github/client'
import type { Credential } from '../../src/main/providers/credentials'
import { GITHUB_ACCESS_DENIED, GITHUB_AUTH_ERROR, GITHUB_CODE_EXPIRED, GITHUB_NOT_VISIBLE } from '../../src/shared/github'

const origins = { login: 'https://login.test', api: 'https://api.test' }
interface Call {
  url: string
  init: RequestInit
  params: URLSearchParams
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Fake fetch: answers by pathname with `routes`, records every call. */
function fakeFetch(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const c = { url, init, params: new URLSearchParams(typeof init.body === 'string' ? init.body : '') }
    calls.push(c)
    const r = routes[new URL(url).pathname]
    return r ? r(c) : new Response('nope', { status: 404 })
  })
  return { fn, calls }
}

function memStore(initial?: Credential): CredentialStore & { data: Map<string, Credential>; removed: number } {
  const data = new Map<string, Credential>(initial ? [['api.test', initial]] : [])
  const s = {
    data,
    removed: 0,
    get: async (h: string) => data.get(h) ?? null,
    save: async (h: string, c: Credential) => (data.set(h, c), true),
    remove: (h: string) => void (data.delete(h), s.removed++)
  }
  return s
}
const stored = (t: GithubToken, login = 'octo') => ({ username: login, password: JSON.stringify(t) })
const tokenOf = (s: ReturnType<typeof memStore>) => JSON.parse(s.data.get('api.test')!.password) as GithubToken
const user = z.object({ login: z.string() })
const bearer = (c: Call) => new Headers(c.init.headers).get('authorization')

afterEach(() => void vi.useRealTimers())

describe('github device flow', () => {
  it('requests a device code with the client id only', async () => {
    const f = fakeFetch({ '/login/device/code': () => json({ device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://evil.test', expires_in: 900, interval: 5 }) })
    const dc = await githubAuth(f.fn, origins).requestDeviceCode()
    expect(dc).toMatchObject({ deviceCode: 'dc', userCode: 'WDJB-MJHT', interval: 5 })
    expect(f.calls[0].url).toBe('https://login.test/login/device/code')
    expect(f.calls[0].init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(new Headers(f.calls[0].init.headers).get('accept')).toBe('application/json')
    expect([...f.calls[0].params]).toEqual([['client_id', CLIENT_ID]])
  })

  it('polls no faster than the interval and slows down on slow_down', async () => {
    vi.useFakeTimers()
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { error: 'slow_down' }, { access_token: 'ghu_a', token_type: 'bearer', scope: '' }]
    const at: number[] = []
    const f = fakeFetch({ '/login/oauth/access_token': () => (at.push(Date.now()), json(answers.shift())) })
    const start = Date.now()
    const p = githubAuth(f.fn, origins).pollToken({ deviceCode: 'dc', userCode: 'X', interval: 5, expiresAt: start + 900_000 }, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(4999)
    expect(at).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await p).toEqual({ access: 'ghu_a' })
    expect(at.map((t) => t - start)).toEqual([5000, 10_000, 20_000, 35_000])
    expect(Object.fromEntries(f.calls[0].params)).toEqual({ client_id: CLIENT_ID, device_code: 'dc', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
  })

  it.each([
    ['expired_token', GITHUB_CODE_EXPIRED],
    ['access_denied', GITHUB_ACCESS_DENIED],
    ['device_flow_disabled', 'Device sign-in is disabled for this GitHub App']
  ])('stops on %s', async (error, message) => {
    vi.useFakeTimers()
    const f = fakeFetch({ '/login/oauth/access_token': () => json({ error }) })
    const p = githubAuth(f.fn, origins).pollToken({ deviceCode: 'dc', userCode: 'X', interval: 1, expiresAt: Date.now() + 900_000 }, new AbortController().signal)
    const err = p.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await err).toMatchObject({ message })
    expect(f.calls).toHaveLength(1)
  })

  it('stops polling when aborted', async () => {
    vi.useFakeTimers()
    const f = fakeFetch({ '/login/oauth/access_token': () => json({ error: 'authorization_pending' }) })
    const ac = new AbortController()
    const err = githubAuth(f.fn, origins).pollToken({ deviceCode: 'dc', userCode: 'X', interval: 1, expiresAt: Date.now() + 900_000 }, ac.signal).catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(2500)
    ac.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await err).toMatchObject({ message: 'Sign-in cancelled' })
    expect(f.calls).toHaveLength(2)
  })

  it('stores a token with and without expiry fields', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    for (const [body, want] of [
      [{ access_token: 'ghu_1', expires_in: 28800, refresh_token: 'ghr_1', refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' }, { access: 'ghu_1', refresh: 'ghr_1', expiresAt: 1_001_000 + 28_800_000, refreshExpiresAt: 1_001_000 + 15_897_600_000 }],
      [{ access_token: 'ghu_2', token_type: 'bearer', scope: '' }, { access: 'ghu_2' }]
    ] as const) {
      const f = fakeFetch({ '/login/oauth/access_token': () => json(body), '/user': (c) => (bearer(c) === `Bearer ${body.access_token}` ? json({ login: 'octo' }) : json({}, 401)) })
      const store = memStore()
      const p = githubAuth(f.fn, origins).pollToken({ deviceCode: 'dc', userCode: 'X', interval: 1, expiresAt: Date.now() + 5000 }, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(1000)
      const t = await p
      expect(t).toEqual(want)
      expect(await githubSession(f.fn, store, origins).save(t!)).toEqual({ login: 'octo', persisted: true })
      expect(store.data.get('api.test')).toEqual({ username: 'octo', password: JSON.stringify(want) })
    }
  })
})

describe('github session', () => {
  const expiring = (): GithubToken => ({ access: 'ghu_old', refresh: 'ghr_old', expiresAt: Date.now() + 30_000, refreshExpiresAt: Date.now() + 1e9 })
  const refreshed = { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' }

  it('refreshes an expiring token once for concurrent requests, without a client secret, and stores the new pair', async () => {
    const store = memStore(stored(expiring()))
    const f = fakeFetch({
      '/login/oauth/access_token': async () => (await new Promise((r) => setTimeout(r, 10)), json(refreshed)),
      '/user': (c) => (bearer(c) === 'Bearer ghu_new' ? json({ login: 'octo' }) : json({}, 401))
    })
    const s = githubSession(f.fn, store, origins)
    expect(await Promise.all([s.api(user, '/user'), s.api(user, '/user')])).toEqual([{ login: 'octo' }, { login: 'octo' }])
    const refreshes = f.calls.filter((c) => c.url.endsWith('/login/oauth/access_token'))
    expect(refreshes).toHaveLength(1)
    expect(Object.fromEntries(refreshes[0].params)).toEqual({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'ghr_old' })
    expect(tokenOf(store)).toMatchObject({ access: 'ghu_new', refresh: 'ghr_new' })
    const api = f.calls.find((c) => c.url.endsWith('/user'))!
    expect(new Headers(api.init.headers).get('accept')).toBe('application/vnd.github+json')
    expect(new Headers(api.init.headers).get('x-github-api-version')).toBe('2022-11-28')
  })

  it('on 401 refreshes and retries once', async () => {
    const store = memStore(stored({ access: 'ghu_old', refresh: 'ghr_old' }))
    const f = fakeFetch({ '/login/oauth/access_token': () => json(refreshed), '/user': (c) => (bearer(c) === 'Bearer ghu_new' ? json({ login: 'octo' }) : json({ message: 'Bad credentials' }, 401)) })
    expect(await githubSession(f.fn, store, origins).api(user, '/user')).toEqual({ login: 'octo' })
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(['/user', '/login/oauth/access_token', '/user'])
  })

  it('a failed refresh clears the credential and yields the auth error', async () => {
    const store = memStore(stored(expiring()))
    const f = fakeFetch({ '/login/oauth/access_token': () => json({ error: 'bad_refresh_token' }) })
    await expect(githubSession(f.fn, store, origins).api(user, '/user')).rejects.toThrow(GITHUB_AUTH_ERROR)
    expect(store.data.size).toBe(0)
    expect(store.removed).toBe(1)
  })

  it.each([
    ['500', () => json({ message: 'boom' }, 500), 'Cannot reach GitHub (HTTP 500)'],
    ['502 with an HTML body', () => new Response('<html>Bad Gateway</html>', { status: 502 }), 'Cannot reach GitHub (HTTP 502)'],
    ['200 with garbage', () => new Response('not json', { status: 200 }), 'Cannot reach GitHub (HTTP 200)']
  ])('a refresh answered with %s keeps the credential, and a later refresh works', async (_, answer, message) => {
    const store = memStore(stored(expiring()))
    let down = true
    const f = fakeFetch({ '/login/oauth/access_token': () => (down ? answer() : json(refreshed)), '/user': (c) => (bearer(c) === 'Bearer ghu_new' ? json({ login: 'octo' }) : json({}, 401)) })
    const s = githubSession(f.fn, store, origins)
    const err = await s.api(user, '/user').then(() => new Error('resolved'), (e: Error) => e)
    expect(err.message).toBe(message)
    expect(store.removed).toBe(0)
    expect(tokenOf(store)).toMatchObject({ access: 'ghu_old', refresh: 'ghr_old' })
    down = false
    expect(await s.api(user, '/user')).toEqual({ login: 'octo' })
    expect(tokenOf(store)).toMatchObject({ access: 'ghu_new', refresh: 'ghr_new' })
  })

  it('no refresh token: a 401 clears the credential', async () => {
    const store = memStore(stored({ access: 'ghu_old' }))
    const f = fakeFetch({ '/user': () => json({}, 401) })
    await expect(githubSession(f.fn, store, origins).api(user, '/user')).rejects.toThrow(GITHUB_AUTH_ERROR)
    expect(store.data.size).toBe(0)
    expect(f.calls).toHaveLength(1)
  })

  it('signed out: the auth error without any request', async () => {
    const f = fakeFetch({})
    await expect(githubSession(f.fn, memStore(), origins).api(user, '/user')).rejects.toThrow(GITHUB_AUTH_ERROR)
    expect(f.calls).toHaveLength(0)
  })

  it('tokens only go to the two origins and never appear in error messages', async () => {
    const store = memStore(stored({ access: 'ghu_secret', refresh: 'ghr_secret' }))
    const f = fakeFetch({ '/login/oauth/access_token': () => json({ error: 'ghr_secret' }, 500), '/user': () => new Response('ghu_secret oops', { status: 401 }) })
    const err = await githubSession(f.fn, store, origins).api(user, '/user').then(() => new Error('resolved'), (e: Error) => e)
    expect(err.message).toBe(GITHUB_AUTH_ERROR)
    const f2 = fakeFetch({ '/user': () => new Response('ghu_secret', { status: 500 }) })
    const err2 = await githubSession(f2.fn, memStore(stored({ access: 'ghu_secret' })), origins).api(user, '/user').then(() => new Error('resolved'), (e: Error) => e)
    expect(err2.message).not.toContain('ghu_secret')
    for (const c of [...f.calls, ...f2.calls]) expect([origins.login, origins.api]).toContain(new URL(c.url).origin)
    const unreachable = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const err3 = await githubSession(unreachable, memStore(stored({ access: 'ghu_secret' })), origins).api(user, '/user').then(() => new Error('resolved'), (e: Error) => e)
    expect(err3.message).toBe('Cannot reach GitHub: fetch failed')
  })
})

describe('github pulls', () => {
  const pull = (n: number, over: Record<string, unknown> = {}) => ({
    number: n,
    title: `PR ${n}`,
    user: { login: 'octo', id: 1 },
    draft: false,
    html_url: `https://github.com/o/r/pull/${n}`,
    updated_at: '2026-11-10T10:00:00Z',
    body: 'text',
    head: { ref: 'feat', repo: { full_name: 'fork/r' }, sha: 'abc' },
    base: { ref: 'main', repo: { full_name: 'o/r' } },
    labels: [],
    ...over
  })
  const session = (route: (c: Call) => Response, path = '/repos/o/r/pulls') => {
    const f = fakeFetch({ [path]: route })
    return { f, s: githubSession(f.fn, memStore(stored({ access: 'ghu_tok' })), origins) }
  }
  const failWith = (status: number, headers: Record<string, string> = {}, body: unknown = { message: 'x' }) =>
    session(() => new Response(JSON.stringify(body), { status, headers })).s.pulls('o/r').then(() => 'resolved', (e: Error) => e.message)

  it('GETs the open pulls (50 per page) with the token and API headers, keeping only the shown fields', async () => {
    const { f, s } = session(() => json([pull(1), pull(2, { draft: true })]))
    const r = await s.pulls('o/r')
    expect(r.more).toBe(false)
    expect(r.pulls.map((p) => p.number)).toEqual([1, 2])
    expect(r.pulls[1].draft).toBe(true)
    expect(r.pulls[0]).toEqual({ number: 1, title: 'PR 1', user: { login: 'octo' }, draft: false, html_url: 'https://github.com/o/r/pull/1', updated_at: '2026-11-10T10:00:00Z', body: 'text', head: { ref: 'feat', repo: { full_name: 'fork/r' } }, base: { ref: 'main' } })
    const u = new URL(f.calls[0].url)
    expect(u.origin + u.pathname).toBe(`${origins.api}/repos/o/r/pulls`)
    expect(Object.fromEntries(u.searchParams)).toEqual({ state: 'open', per_page: '50' })
    const h = new Headers(f.calls[0].init.headers)
    expect(h.get('authorization')).toBe('Bearer ghu_tok')
    expect(h.get('accept')).toBe('application/vnd.github+json')
    expect(h.get('x-github-api-version')).toBe('2022-11-28')
    expect(f.calls[0].init.redirect).toBe('error')
  })

  it('encodes each part of an odd repo name', async () => {
    const { f, s } = session(() => json([]), '/repos/o%20x/r%23y%3Fz/pulls')
    expect(await s.pulls('o x/r#y?z')).toEqual({ pulls: [], more: false })
    expect(f.calls[0].url).toBe(`${origins.api}/repos/o%20x/r%23y%3Fz/pulls?state=open&per_page=50`)
  })

  it('a null body and a deleted fork (head.repo null) parse', async () => {
    const r = await session(() => json([pull(3, { body: null, head: { ref: 'gone', repo: null } })])).s.pulls('o/r')
    expect(r.pulls[0].body).toBeNull()
    expect(r.pulls[0].head).toEqual({ ref: 'gone', repo: null })
  })

  it('a response that does not match the schema is an error', async () => {
    await expect(session(() => json([{ number: 'x' }])).s.pulls('o/r')).rejects.toThrow('Unexpected response from GitHub for /repos/o/r/pulls')
    await expect(session(() => json({ message: 'hi' })).s.pulls('o/r')).rejects.toThrow('Unexpected response from GitHub')
  })

  it('Link rel="next" means more pages', async () => {
    const link = '<https://api.github.com/repositories/1/pulls?state=open&per_page=50&page=2>; rel="next", <https://api.github.com/repositories/1/pulls?page=3>; rel="last"'
    const { s } = session(() => new Response(JSON.stringify([pull(1)]), { headers: { link } }))
    expect((await s.pulls('o/r')).more).toBe(true)
    const prev = '<https://api.github.com/repositories/1/pulls?page=1>; rel="prev"'
    expect((await session(() => new Response('[]', { headers: { link: prev } })).s.pulls('o/r')).more).toBe(false)
  })

  it('errors in order: auth, rate limit with reset, retry-after, rate limit message, cannot see, other', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const hhmm = new Date(reset * 1000).toTimeString().slice(0, 5)
    const all = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset), 'retry-after': '30' }
    expect(await failWith(401, all, { message: 'API rate limit exceeded' })).toBe(GITHUB_AUTH_ERROR)
    expect(await failWith(403, all, { message: 'API rate limit exceeded' })).toBe(`Rate limited until ${hhmm}`)
    expect(await failWith(429, all)).toBe(`Rate limited until ${hhmm}`)
    expect(await failWith(403, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': String(reset), 'retry-after': '30' }, { message: 'secondary rate limit' })).toBe('Rate limited, retry in 30 s')
    expect(await failWith(429, { 'retry-after': '7' })).toBe('Rate limited, retry in 7 s')
    expect(await failWith(403, {}, { message: 'You have exceeded a secondary rate limit.' })).toBe('Rate limited, try again in a minute')
    expect(await failWith(429, {}, { message: 'API Rate Limit exceeded' })).toBe('Rate limited, try again in a minute')
    expect(await failWith(403, {}, { message: 'Resource not accessible by integration' })).toBe(GITHUB_NOT_VISIBLE)
    expect(await failWith(404, {}, { message: 'Not Found' })).toBe(GITHUB_NOT_VISIBLE)
    expect(await failWith(429, {}, { message: 'slow' })).toBe('GitHub error 429')
    expect(await failWith(500, all, { message: 'rate limit' })).toBe('GitHub error 500')
  })

  it('GETs one pull request by number (each repo part encoded), zod-validated, head.repo may be null', async () => {
    const { f, s } = session(() => json(pull(7, { head: { ref: 'feat/x', repo: { full_name: 'o/r' } } })), '/repos/o%20x/r%23y/pulls/7')
    expect((await s.pull('o x/r#y', 7)).head).toEqual({ ref: 'feat/x', repo: { full_name: 'o/r' } })
    expect(f.calls[0].url).toBe(`${origins.api}/repos/o%20x/r%23y/pulls/7`)
    expect(new Headers(f.calls[0].init.headers).get('authorization')).toBe('Bearer ghu_tok')
    expect((await session(() => json(pull(8, { head: { ref: 'gone', repo: null } })), '/repos/o/r/pulls/8').s.pull('o/r', 8)).head.repo).toBeNull()
    await expect(session(() => json({ number: 9 }), '/repos/o/r/pulls/9').s.pull('o/r', 9)).rejects.toThrow('Unexpected response from GitHub for /repos/o/r/pulls/9')
    await expect(session(() => json({ message: 'Not Found' }, 404), '/repos/o/r/pulls/9').s.pull('o/r', 9)).rejects.toThrow(GITHUB_NOT_VISIBLE)
    await expect(s.pull('o/r', 0)).rejects.toThrow('Invalid pull request number')
    await expect(s.pull('o/r', 1.5)).rejects.toThrow('Invalid pull request number')
  })

  it('a 403/404 outside repo calls is a plain error, not the cannot-see text', async () => {
    const f = fakeFetch({ '/user': () => json({ message: 'Not Found' }, 404) })
    await expect(githubSession(f.fn, memStore(stored({ access: 'ghu_tok' })), origins).api(user, '/user')).rejects.toThrow('GitHub error 404')
  })
})
