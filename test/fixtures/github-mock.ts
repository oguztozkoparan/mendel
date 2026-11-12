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
  /** Mutable: `GET /repos/<owner>/<repo>/pulls` answers these (GitHub's shape, see `mockPull`); `/pulls/<n>` the one numbered n. */
  pulls: Record<string, unknown>[]
  /** Mutable: adds a Link rel="next" header to the pulls answer. */
  more: boolean
  /** Mutable: the pulls answer as GitHub gives it when the app cannot see the repo, or when rate limited. */
  pullsMode: 'ok' | 'notFound' | 'rateLimited'
}

/** A pull request body exercising GitHub-flavoured Markdown, links of every kind and raw HTML that must not render. */
export const richBody = [
  '# Summary heading',
  '',
  'This paragraph has a soft',
  'line break, `inline code`, **bold**, *italic* and ~~struck~~ text.',
  '',
  '## Changes',
  '',
  '- first item',
  '- second item',
  '',
  '- [x] done task',
  '- [ ] open task',
  '',
  '| Column | Centred | A long column |',
  '| :--- | :---: | ---: |',
  `| a | 1 | ${'widecell'.repeat(25)}end |`,
  '',
  '```ts',
  `const longLine = '${'code-'.repeat(60)}end'`,
  '```',
  '',
  '> A quoted line',
  '',
  '---',
  '',
  'Links: [relative link](docs/guide.md), [github link](https://github.com/o/r/issues/1), [external link](https://example.com/page), and bare https://github.com/o/r/wiki',
  '',
  '[script link](javascript:alert(1))',
  '',
  '![diagram alt](https://example.com/diagram.png)',
  '',
  '<script>alert(1)</script>',
  '',
  'Inline <img src=x onerror="alert(1)"> html.',
  '',
  '<details><summary>Hidden summary</summary>Hidden details</details>',
  '',
  '<!-- template comment -->',
  '',
  'A claim with a footnote[^note].',
  '',
  '[^note]: The footnote text.',
  '',
  'The end.'
].join('\n')

/** One open pull request as `GET /repos/{owner}/{repo}/pulls` returns it (trimmed). */
export const mockPull = (number: number, over: Partial<{ title: string; login: string; draft: boolean; body: string | null; head: string; base: string; headRepo: string | null }> = {}) => ({
  number,
  title: over.title ?? `Pull request ${number}`,
  user: { login: over.login ?? 'hubot' },
  draft: over.draft ?? false,
  html_url: `https://github.com/o/r/pull/${number}`,
  updated_at: new Date(Date.now() - 3_600_000).toISOString(),
  body: over.body === undefined ? `Body of ${number}` : over.body,
  head: { ref: over.head ?? `feature-${number}`, repo: over.headRepo === null ? null : { full_name: over.headRepo ?? 'o/r' } },
  base: { ref: over.base ?? 'main' }
})

const json = (body: unknown, status = 200): MockResponse => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** github.com login endpoints + api.github.com `/user` and `/repos/<owner>/<repo>/pulls` on one loopback server (MENDEL_E2E_GITHUB); interval 1 s so e2e stays fast. */
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
    // Any `GET /repos/<owner>/<repo>/pulls[/<n>]`, so tests can use long repo names.
    '*': (r) => {
      const path = /^\/repos\/[^/]+\/[^/]+\/pulls(?:\/(\d+))?$/.exec(new URL(r.url, 'http://x').pathname)
      if (r.method !== 'GET' || !path) return { status: 404, body: 'Not found' }
      if (!m.access || r.headers.authorization !== `Bearer ${m.access}`) return json({ message: 'Bad credentials' }, 401)
      if (m.pullsMode === 'notFound') return json({ message: 'Not Found' }, 404)
      if (m.pullsMode === 'rateLimited')
        return { status: 403, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }, body: JSON.stringify({ message: 'API rate limit exceeded' }) }
      if (path[1]) {
        const one = m.pulls.find((p) => p.number === Number(path[1]))
        return one ? json(one) : json({ message: 'Not Found' }, 404)
      }
      const res = json(m.pulls)
      if (m.more) res.headers!.link = `<${server.url}/repositories/1/pulls?state=open&per_page=50&page=2>; rel="next"`
      return res
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
    pulls: [],
    more: false,
    pullsMode: 'ok',
    polls: () => server.requests.filter((r) => r.url === '/login/oauth/access_token' && form(r).get('device_code')).length
  }
  return m
}
