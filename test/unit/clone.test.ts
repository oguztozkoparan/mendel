import { describe, expect, it } from 'vitest'
import { parseCloneProgress, validateCloneUrl } from '../../src/main/git/clone'

describe('validateCloneUrl', () => {
  it.each(['https://host/p.git', 'ssh://git@host:29418/p/q', 'git@github.com:o/r.git', 'file:///tmp/remote.git', '  https://h/p  '])(
    'allows %s',
    (u) => expect(validateCloneUrl(u)).toBe(u.trim())
  )
  it.each([
    '-oProxyCommand=x',
    'ssh://-oProxyCommand=touch%20x/p',
    'ssh://-oProxy@host/p',
    'ext::sh -c touch% /tmp/pwned',
    'fd::17',
    'http://host/p.git',
    'git://host/p.git',
    '/abs/local/path',
    'host:path',
    '-u@host:p',
    'https://host/p\nx',
    ''
  ])('rejects %j', (u) => expect(() => validateCloneUrl(u)).toThrow())
})

describe('parseCloneProgress', () => {
  it('takes the last phase/percent in a chunk', () => {
    expect(parseCloneProgress('Receiving objects:  10% (1/10)\rReceiving objects:  45% (5/10)\r')).toEqual({ phase: 'Receiving objects', percent: 45 })
    expect(parseCloneProgress("Cloning into 'x'...\n")).toBeNull()
  })
})
