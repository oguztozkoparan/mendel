import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GERRIT_AUTH_ERROR } from '../../src/shared/gerrit'
import { gerritClient, parseGerritJson } from '../../src/main/providers/gerrit/client'
import { SELF, startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'

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

  it('reports unreachable servers', async () => {
    await expect(gerritClient('http://127.0.0.1:1', { username: 'u', password: 'p' }, fetch).self()).rejects.toThrow(/Cannot reach Gerrit/)
  })
})
