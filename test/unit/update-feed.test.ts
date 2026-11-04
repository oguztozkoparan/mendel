import { describe, expect, it } from 'vitest'
import { canSelfInstall, downloadUrl, externalAllowed, parseFeed, urlAllowed } from '../../src/main/update/feed'

describe('update feed', () => {
  it('accepts only https feeds (loopback http when allowed)', () => {
    expect(urlAllowed('https://dl.example.com/mendel/', false)).toBe(true)
    expect(urlAllowed('http://dl.example.com/mendel/', false)).toBe(false)
    expect(urlAllowed('http://127.0.0.1:9/', false)).toBe(false)
    expect(urlAllowed('http://127.0.0.1:9/', true)).toBe(true)
    expect(urlAllowed('http://evil.com/', true)).toBe(false)
    expect(urlAllowed('https://u:p@dl.example.com/', false)).toBe(false)
    expect(urlAllowed('file:///etc/passwd', true)).toBe(false)
    expect(urlAllowed('not a url', true)).toBe(false)
  })

  it('parses app-update.yml', () => {
    expect(parseFeed('owner: acme\nrepo: mendel\nprovider: github\nupdaterCacheDirName: mendel-updater\n')).toEqual({ provider: 'github', owner: 'acme', repo: 'mendel' })
    expect(parseFeed("provider: generic\nurl: 'https://dl.example.com/mendel/'\n")).toEqual({ provider: 'generic', url: 'https://dl.example.com/mendel/' })
    expect(parseFeed('provider: generic\nurl: http://dl.example.com/\n')).toBeNull()
    expect(parseFeed('provider: s3\nbucket: x\n')).toBeNull()
    expect(parseFeed('provider: github\nowner: ../x\nrepo: y\n')).toBeNull()
  })

  it('self-installs only where the platform allows it unsigned', () => {
    const o = { appImage: false, macAutoInstall: false }
    expect(canSelfInstall('win32', o)).toBe(true)
    expect(canSelfInstall('darwin', o)).toBe(false)
    expect(canSelfInstall('darwin', { ...o, macAutoInstall: true })).toBe(true)
    expect(canSelfInstall('linux', o)).toBe(false)
    expect(canSelfInstall('linux', { ...o, appImage: true })).toBe(true)
  })

  it('builds an allowlisted download url', () => {
    const gh = { provider: 'github', owner: 'acme', repo: 'mendel' } as const
    const gen = { provider: 'generic', url: 'https://dl.example.com/mendel' } as const
    const files = [{ url: 'mendel-1.2.0-arm64.zip' }, { url: 'mendel-1.2.0-arm64.dmg' }]
    expect(downloadUrl(gh, '1.2.0', files, 'darwin')).toBe('https://github.com/acme/mendel/releases/tag/v1.2.0')
    expect(downloadUrl(gen, '1.2.0', files, 'darwin')).toBe('https://dl.example.com/mendel/mendel-1.2.0-arm64.dmg')
    expect(externalAllowed('https://github.com/acme/mendel/releases/tag/v1.2.0', gh, false)).toBe(true)
    expect(externalAllowed('https://evil.com/x', gh, false)).toBe(false)
    const evil = downloadUrl(gen, '1.2.0', [{ url: 'https://evil.com/x.dmg' }], 'darwin')
    expect(externalAllowed(evil, gen, false)).toBe(false)
  })
})
