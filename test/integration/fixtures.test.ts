import { afterEach, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'
import { startMockServer } from '../fixtures/mock-server'

describe('repo fixture', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('creates an isolated work clone pushing to a bare remote', () => {
    fx = createRepoFixture()
    expect(fx.git(['config', 'user.email'])).toBe('test@example.com')
    expect(fx.git(['config', '--show-origin', 'user.email'])).toContain(fx.dir)
    expect(fx.git(['branch', '--show-current'])).toBe('main')
    const sha = fx.commitFile('src/a.txt', 'a\n')
    fx.git(['push', '-q', 'origin', 'main'])
    expect(fx.git(['rev-parse', 'main'], fx.remote)).toBe(sha)
  })
})

describe('mock server', () => {
  it('routes by method + pathname and records requests', async () => {
    const srv = await startMockServer({ 'POST /a/echo': (r) => ({ status: 201, body: r.body }) })
    try {
      const ok = await fetch(`${srv.url}/a/echo?x=1`, { method: 'POST', body: 'hi' })
      expect([ok.status, await ok.text()]).toEqual([201, 'hi'])
      expect((await fetch(`${srv.url}/nope`)).status).toBe(404)
      expect(srv.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /a/echo?x=1', 'GET /nope'])
    } finally {
      await srv.close()
    }
  })
})
