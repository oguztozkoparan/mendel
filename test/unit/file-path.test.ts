import { describe, expect, it } from 'vitest'
import { fullPath, splitPath } from '../../src/renderer/src/paths'

describe('splitPath', () => {
  it('root file: no folder', () => expect(splitPath('README.md')).toEqual(['', 'README.md']))
  it('nested file: folder and name', () => expect(splitPath('src/renderer/src/App.tsx')).toEqual(['src/renderer/src', 'App.tsx']))
  it('trailing slash (directory / submodule entry) stays on the name', () => {
    expect(splitPath('vendor/lib/')).toEqual(['vendor', 'lib/'])
    expect(splitPath('lib/')).toEqual(['', 'lib/'])
  })
  it('spaces and unicode', () => expect(splitPath('docs/My Notes/über straße.md')).toEqual(['docs/My Notes', 'über straße.md']))
  // git prints '/' on every platform; a backslash is part of a file name
  it('backslash is not a separator', () => expect(splitPath('a\\b.txt')).toEqual(['', 'a\\b.txt']))
})

describe('fullPath', () => {
  it('plain and renamed', () => {
    expect(fullPath('a/b.ts')).toBe('a/b.ts')
    expect(fullPath('a/c.ts', 'a/b.ts')).toBe('a/b.ts → a/c.ts')
  })
})
