import { describe, expect, it } from 'vitest'
import { githubLink, onGithub } from '../../src/shared/github'

/** What `github:openLink` opens for a link in a pull request body of o/r (null = nothing). */
const opens = (href: string) => {
  const u = githubLink('o/r', href)
  return u && onGithub(u) ? u.href : null
}

describe('pull request body links', () => {
  it('opens github.com links, relative ones resolved against the repo page', () => {
    expect(opens('docs/a.md')).toBe('https://github.com/o/r/docs/a.md')
    expect(opens('../other/issues/3')).toBe('https://github.com/o/other/issues/3')
    expect(opens('/o/r/blob/main/x.ts')).toBe('https://github.com/o/r/blob/main/x.ts')
    expect(opens('#usage')).toBe('https://github.com/o/r/#usage')
    expect(opens('https://github.com/other/repo/pull/1')).toBe('https://github.com/other/repo/pull/1')
    expect(opens('https://GITHUB.com/x')).toBe('https://github.com/x')
    expect(opens('//github.com/o/r')).toBe('https://github.com/o/r')
  })

  it('opens nothing else', () => {
    for (const href of [
      '//example.com/path',
      'https://github.com.evil.example/',
      'https://evil.example/github.com',
      'https://user:pass@github.com/',
      'https://user@github.com/',
      'http://github.com/',
      'https://github.com:8443/',
      'https://api.github.com/repos/o/r',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'mailto:a@example.com',
      `https://github.com/${'a'.repeat(5000)}`
    ])
      expect(opens(href), href).toBeNull()
  })

  it('resolves external links so the UI can copy them; unparsable or too long is null', () => {
    expect(githubLink('o/r', '//example.com/path')?.href).toBe('https://example.com/path')
    expect(githubLink('o/r', 'https://[bad')).toBeNull()
    expect(githubLink('o/r', 'x'.repeat(4097))).toBeNull()
  })
})
