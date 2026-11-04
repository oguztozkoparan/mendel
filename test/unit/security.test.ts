import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redact } from '../../src/main/redact'
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
