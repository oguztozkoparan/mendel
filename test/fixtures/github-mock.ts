import { startMockServer, type MockRequest, type MockResponse, type MockServer } from './mock-server'

export interface GithubMockOptions {
  login?: string
  /** Poll answers of authorization_pending before `outcome` (default 1). */
  pending?: number
  outcome?: 'success' | 'denied' | 'expired'
}

export interface GithubMock extends MockServer {
  login: string
  userCode: string
  /** Mutable: tests change them between polls. */
  pending: number
  outcome: 'success' | 'denied' | 'expired'
  /** Current valid access token (rotated by each refresh). */
  access: string
  /** Device-flow token polls received. */
  polls(): number
}

const json = (body: unknown, status = 200): MockResponse => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** github.com login endpoints + api.github.com `/user` on one loopback server (MENDEL_E2E_GITHUB); interval 1 s so e2e stays fast. */
export async function startGithubMock(opts: GithubMockOptions = {}): Promise<GithubMock> {
  let n = 0
  const token = () => {
    n++
    m.access = `ghu_mock${n}`
    return { access_token: m.access, expires_in: 28800, refresh_token: `ghr_mock${n}`, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' }
  }
  const form = (r: MockRequest) => new URLSearchParams(r.body)
  const server = await startMockServer({
    'POST /login/device/code': () => json({ device_code: 'mock-device-code', user_code: m.userCode, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 }),
    'POST /login/oauth/access_token': (r) => {
      const f = form(r)
      if (f.get('grant_type') === 'refresh_token') return f.get('refresh_token') === `ghr_mock${n}` ? json(token()) : json({ error: 'bad_refresh_token' })
      if (f.get('device_code') !== 'mock-device-code') return json({ error: 'incorrect_device_code' })
      if (m.pending > 0) return m.pending--, json({ error: 'authorization_pending' })
      if (m.outcome === 'denied') return json({ error: 'access_denied' })
      if (m.outcome === 'expired') return json({ error: 'expired_token' })
      return json(token())
    },
    'GET /user': (r) => (m.access && r.headers.authorization === `Bearer ${m.access}` ? json({ login: m.login, id: 1 }) : json({ message: 'Bad credentials' }, 401))
  })
  const m: GithubMock = {
    ...server,
    login: opts.login ?? 'octocat',
    userCode: 'WDJB-MJHT',
    pending: opts.pending ?? 1,
    outcome: opts.outcome ?? 'success',
    access: '',
    polls: () => server.requests.filter((r) => r.url === '/login/oauth/access_token' && form(r).get('device_code')).length
  }
  return m
}
