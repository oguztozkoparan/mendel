import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redact, redactDeep } from '../../src/main/redact'
import { resolveUnder } from '../../src/main/safe-path'

describe('redact', () => {
  it('strips url userinfo, auth headers and tokens', () => {
    expect(redact('fatal: https://bob:s3cret@host/x.git failed')).toBe('fatal: https://***@host/x.git failed')
    expect(redact('ssh://git@host:29418/p')).toBe('ssh://***@host:29418/p')
    expect(redact('Authorization: Basic Ym9iOnMz')).toBe('Authorization: Basic ***')
    expect(redact('authorization: abc123')).toBe('authorization: ***')
    expect(redact('GET /a?access_token=xyz&n=1')).toBe('GET /a?access_token=***&n=1')
    expect(redact('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
  })
  it('strips bare GitHub tokens', () => {
    const body = 'A1b2C3d4E5f6G7h8I9j0K1l2'
    for (const t of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'].map((p) => p + body).concat(`github_pat_11AB_${body}_x`)) {
      expect(redact(`push failed: bad credentials ${t} (401)`)).toBe('push failed: bad credentials *** (401)')
      expect(redact(`GET https://api.github.com/user?t=${t}&n=1`)).toBe('GET https://api.github.com/user?t=***&n=1')
      expect(redact(JSON.stringify({ token: t }))).toBe('{"token":"***"}')
    }
    expect(redact('ghp_short github_pat_short ghost ghp gho_ the github_pat_ docs')).toBe('ghp_short github_pat_short ghost ghp gho_ the github_pat_ docs')
  })
  it('handles @ inside the password and nested log objects (S11)', () => {
    expect(redact('https://bob:p@ss@w0rd@host/x.git and ssh://a@b/c')).toBe('https://***@host/x.git and ssh://***@b/c')
    expect(redactDeep({ url: 'https://u:p@h/x', n: 1, list: ['Authorization: Bearer t'], err: new Error('https://u:p@h') })).toMatchObject({
      url: 'https://***@h/x',
      n: 1,
      list: ['Authorization: Bearer ***'],
      err: expect.stringContaining('https://***@h')
    })
  })
})

describe('resolveUnder', () => {
  const root = path.resolve('/srv/app')
  it('resolves inside root', () => {
    expect(resolveUnder(root, 'index.html')).toBe(path.join(root, 'index.html'))
    expect(resolveUnder(root, 'a/../b.js')).toBe(path.join(root, 'b.js'))
  })
  it('rejects escapes, absolute paths and NUL', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\0b', '..']) expect(resolveUnder(root, bad)).toBeNull()
  })
})
