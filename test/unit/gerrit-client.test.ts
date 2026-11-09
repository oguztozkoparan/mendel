import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GERRIT_AUTH_ERROR } from '../../src/shared/gerrit'
import { gerritClient, HINT_TIMEOUT_MS, parseGerritJson } from '../../src/main/providers/gerrit/client'
import { invoke } from '../../src/shared/ipc'
import { OTHER, SELF, startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'

let mock: GerritMock
beforeAll(async () => void (mock = await startGerritMock()))
afterAll(() => mock.close())
const client = (password = mock.password) => gerritClient(mock.url, { username: mock.username, password }, fetch)

describe('gerrit client', () => {
  it('strips the XSSI prefix only at offset 0', () => {
    expect(parseGerritJson(")]}'\n{\"a\":1}")).toEqual({ a: 1 })
    expect(() => parseGerritJson(" )]}'\n{}")).toThrow()
  })

  it('authenticates with Basic auth under /a/', async () => {
    expect(await client().self()).toEqual(SELF)
    const req = mock.find('GET', '/a/accounts/self').at(-1)!
    expect(req.headers.authorization).toBe('Basic ' + Buffer.from(`${mock.username}:${mock.password}`).toString('base64'))
  })

  it('maps 401 to the auth error and never echoes the password', async () => {
    const err = await client('nope').self().catch((e: Error) => e)
    expect(err).toMatchObject({ status: 401, message: GERRIT_AUTH_ERROR })
    expect(String((err as Error).message)).not.toContain('nope')
  })

  it('gives up on a hanging Change-Id lookup after the short hint timeout', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
    const started = Date.now()
    await expect(gerritClient(mock.url, { username: 'u', password: 'p' }, hang).openChanges(['I' + '0'.repeat(40)], null)).rejects.toThrow('Cannot reach Gerrit')
    expect(Date.now() - started).toBeLessThan(HINT_TIMEOUT_MS + 1000)
  })

  it('finds open changes by Change-Id in a project', async () => {
    const id = (n: number) => `I${String(n).padStart(40, '0')}`
    expect((await client().openChanges([id(101), id(90), id(5)], 'p/q')).map((c) => c._number)).toEqual([101]) // #90 is merged
    expect(decodeURIComponent(mock.find('GET', '/a/changes/').at(-1)!.url)).toContain(`q=status:open (change:${id(101)} OR change:${id(90)} OR change:${id(5)}) project:"p/q"`)
  })

  it('escapes quotes and backslashes in the project query term (S10)', async () => {
    await client().listChanges('a" OR owner:x \\')
    expect(decodeURIComponent(mock.find('GET', '/a/changes/').at(-1)!.url)).toContain('project:"a\\" OR owner:x \\\\"')
  })

  it('edits the attention set (remove self answers 204 No Content) and hashtags', async () => {
    await client().attention(101, 'self', false, 'r')
    expect(mock.find('POST', '/a/changes/101/attention/self/delete').at(-1)!.body).toBe('{"reason":"r"}')
    await client().attention(101, OTHER._account_id, true, 'r')
    expect(Object.keys((await client().change(101)).attention_set ?? {})).toEqual([String(OTHER._account_id)])
    expect(await client().hashtags(101, ['b', 'a'], ['ux'])).toEqual(['a', 'b'])
  })

  it('rejects hashtags with whitespace, commas or control characters at the IPC boundary', () => {
    const ok = (tag: string) => invoke['gerrit:hashtags'].req.safeParse({ repo: '/r', change: 1, add: [tag], remove: [] }).success
    expect(ok('release-1.2')).toBe(true)
    for (const bad of ['', 'a b', 'a,b', 'a\tb', 'a\u0000', 'x'.repeat(101)]) expect(ok(bad)).toBe(false)
  })

  it('reports unreachable servers', async () => {
    await expect(gerritClient('http://127.0.0.1:1', { username: 'u', password: 'p' }, fetch).self()).rejects.toThrow(/Cannot reach Gerrit/)
  })
})
