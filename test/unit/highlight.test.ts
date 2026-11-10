import { parseDiff } from 'react-diff-view'
import { describe, expect, it } from 'vitest'
import { highlight, highlightLines, languageOf } from '../../src/renderer/src/highlight'

describe('languageOf', () => {
  it('maps extensions and well-known names to bundled grammars', () => {
    expect(languageOf('src/a.ts')).toBe('typescript')
    expect(languageOf('src/App.TSX')).toBe('tsx')
    expect(languageOf('styles/x.module.css')).toBe('css')
    expect(languageOf('index.html')).toBe('markup')
    expect(languageOf('ci.yml')).toBe('yaml')
    expect(languageOf('main.rs')).toBe('rust')
    expect(languageOf('docker/Dockerfile')).toBe('docker')
  })
  it('is plain text for unknown, extensionless and dotfiles', () => {
    expect(languageOf('LICENSE')).toBeUndefined()
    expect(languageOf('a.unknownext')).toBeUndefined()
    expect(languageOf('.gitignore')).toBeUndefined()
  })
})

describe('highlight', () => {
  const hunks = parseDiff('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-let a = 1\n+const a = "x"\n')[0]!.hunks
  it('tokenizes both sides of a known language', () => {
    const t = highlight(hunks, 'a.ts')!
    expect(JSON.stringify(t.new[0])).toContain('keyword')
    expect(JSON.stringify(t.old[0])).toContain('number')
  })
  it('skips unknown languages', () => expect(highlight(hunks, 'a.txt')).toBeUndefined())
  it('gives per-line tokens for whole files (blame)', () => expect(JSON.stringify(highlightLines(['// c', 'x'], 'a.js')![0])).toContain('comment'))
})
