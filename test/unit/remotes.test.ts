import { describe, expect, it } from 'vitest'
import { detectProvider, registerProvider } from '../../src/main/providers'
import { parseRemote, projectFromPath } from '../../src/main/providers/remotes'

describe('parseRemote', () => {
  it('parses ssh urls with port and user', () => {
    expect(parseRemote('origin', 'ssh://u@host:29418/p/q')).toEqual({
      name: 'origin', url: 'ssh://u@host:29418/p/q', protocol: 'ssh', host: 'host', port: 29418, user: 'u', path: '/p/q'
    })
  })
  it('parses scp-style and https, never keeping a password', () => {
    expect(parseRemote('o', 'git@github.com:o/r.git')).toMatchObject({ protocol: 'ssh', host: 'github.com', user: 'git', path: 'o/r.git' })
    const r = parseRemote('o', 'https://bob:secret@gerrit.example.com/a/p/q')!
    expect(r).toMatchObject({ protocol: 'https', host: 'gerrit.example.com', user: 'bob', path: '/a/p/q' })
    expect(JSON.stringify({ ...r, url: '' })).not.toContain('secret')
    expect(parseRemote('o', 'http://h:8080/r/x')).toMatchObject({ protocol: 'https', port: 8080 })
  })
  it('treats local paths (incl. Windows drives) as file and rejects odd schemes', () => {
    expect(parseRemote('o', '/tmp/remote.git')).toMatchObject({ protocol: 'file', host: '' })
    expect(parseRemote('o', 'C:\\repos\\x')).toMatchObject({ protocol: 'file' })
    expect(parseRemote('o', 'file:///tmp/r.git')).toMatchObject({ protocol: 'file' })
    expect(parseRemote('o', 'git://h/p')).toBeNull()
  })
  it('derives the project name', () => {
    expect(projectFromPath('/team/project.git')).toBe('team/project')
    expect(projectFromPath('team/project/')).toBe('team/project')
  })
})

describe('detectProvider', () => {
  it('returns the first registered provider that matches', async () => {
    const r = parseRemote('origin', 'ssh://h:1/x')!
    expect(await detectProvider([r], async () => null)).toBeNull()
    registerProvider({ id: 'github', detect: async (rs) => (rs[0].host === 'h' ? { provider: 'github', remote: 'origin', host: 'h', baseUrl: null, project: 'x' } : null) })
    expect(await detectProvider([r], async () => null)).toMatchObject({ provider: 'github' })
  })
})
