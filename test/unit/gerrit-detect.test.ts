import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectProvider, forgetNegatives, registerProvider, type Probe } from '../../src/main/providers'
import { normalizeBaseUrl } from '../../src/main/providers/gerrit/client'
import { candidates, gerritProvider, projectOf } from '../../src/main/providers/gerrit/detect'
import { parseRemote } from '../../src/main/providers/remotes'
import { startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'

let mock: GerritMock
beforeAll(async () => void (mock = await startGerritMock()))
afterAll(() => mock.close())

/** Probe that serves `https://<host><prefix>` from the mock; everything else is a network error. */
const probeVia =
  (host: string, prefix = ''): Probe =>
  async (url) => {
    const base = `https://${host}${prefix}`
    if (!url.startsWith(base + '/')) return null
    const res = await fetch(mock.url + url.slice(base.length))
    return { status: res.status, body: await res.text() }
  }
const remote = (url: string) => parseRemote('origin', url)!

describe('gerrit detection', () => {
  it('ssh :29418 remote → gerrit, project p/q, base url probed, version recorded', async () => {
    const d = await gerritProvider.detect([remote('ssh://u@host:29418/p/q')], probeVia('host'))
    expect(d).toEqual({ provider: 'gerrit', remote: 'origin', host: 'host', baseUrl: 'https://host', project: 'p/q', serverVersion: '3.1.3', user: 'u' })
    expect(mock.find('GET', '/config/server/version').length).toBeGreaterThan(0)
  })

  it('finds the base under /r and strips it plus /a/ from https project paths', async () => {
    const d = await gerritProvider.detect([remote('https://host/r/a/p/q.git')], probeVia('host', '/r'))
    expect(d).toMatchObject({ baseUrl: 'https://host/r', project: 'p/q' })
    expect(projectOf(remote('https://host/gerrit/x/y'), 'https://host/gerrit')).toBe('x/y')
    expect(candidates(remote('https://h:8443/a/p'))).toEqual(['https://h:8443', 'https://h:8443/r', 'https://h:8443/gerrit'])
  })

  it('no hints and probe 404 → no provider; github.com is never probed', async () => {
    expect(await gerritProvider.detect([remote('https://plain.example.com/x/y.git')], async () => ({ status: 404, body: 'nope' }))).toBeNull()
    let probed = false
    expect(await gerritProvider.detect([remote('git@github.com:o/r.git')], async () => ((probed = true), null))).toBeNull()
    expect(probed).toBe(false)
  })

  it('remembers hosts that are not Gerrit, but not hosts that were unreachable (R4)', async () => {
    registerProvider(gerritProvider)
    let calls = 0
    const no: Probe = async () => (calls++, { status: 404, body: '' })
    const r = [remote('https://neg.example.com/x.git')]
    expect(await detectProvider(r, no)).toBeNull()
    const first = calls
    expect(first).toBeGreaterThan(0)
    expect(await detectProvider(r, no)).toBeNull()
    expect(calls).toBe(first)
    forgetNegatives()
    await detectProvider(r, no)
    expect(calls).toBe(2 * first)
    const down = [remote('https://down.example.com/x.git')]
    const offline: Probe = async () => (calls++, null)
    await detectProvider(down, offline)
    const before = calls
    await detectProvider(down, offline)
    expect(calls).toBeGreaterThan(before)
  })

  it('probe failure + port 29418 → active without base url', async () => {
    expect(await gerritProvider.detect([remote('ssh://u@host:29418/p/q')], async () => null)).toMatchObject({ provider: 'gerrit', baseUrl: null, project: 'p/q' })
  })
})

describe('normalizeBaseUrl', () => {
  it('accepts https, trims slashes and /a; loopback http only when allowed', () => {
    expect(normalizeBaseUrl(' https://g.example.com/r/a/ ', false)).toBe('https://g.example.com/r')
    expect(normalizeBaseUrl('http://127.0.0.1:8080', true)).toBe('http://127.0.0.1:8080')
    for (const bad of ['http://127.0.0.1:8080', 'http://g.example.com', 'https://u:p@g.example.com', 'ftp://x', 'https://g.example.com/?q=1', 'javascript:alert(1)'])
      expect(() => normalizeBaseUrl(bad, false)).toThrow()
  })
})
