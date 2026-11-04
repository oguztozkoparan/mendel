import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getStatus, ignorePath, ignorePattern } from '../../src/main/git/changes'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('ignore file', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('appends an exact, anchored pattern that ignores only that file', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, '.gitignore'), 'node_modules') // no trailing newline
    for (const f of ['ab[1].txt', 'ab1.txt', '#x', 'sub/#x']) (mkdirSync(path.dirname(path.join(fx.work, f)), { recursive: true }), writeFileSync(path.join(fx.work, f), 'x'))
    ignorePath(fx.work, 'ab[1].txt')
    ignorePath(fx.work, '#x')
    expect(readFileSync(path.join(fx.work, '.gitignore'), 'utf8')).toBe('node_modules\n/ab\\[1].txt\n/#x\n')
    const left = (await getStatus(fx.work, fx.env)).map((f) => f.path).sort()
    expect(left).toEqual(['.gitignore', 'ab1.txt', 'sub/#x'])
    // Names Windows can't create: pattern only.
    expect(ignorePattern('a*b?.txt')).toBe('/a\\*b\\?.txt')
    expect(ignorePattern('sp  ')).toBe('/sp\\ \\ ')
  })

  // Symlinks need extra privileges on Windows.
  it.skipIf(process.platform === 'win32')('refuses names git cannot express and a symlinked .gitignore', () => {
    fx = createRepoFixture()
    expect(() => ignorePattern('a\nb')).toThrow()
    writeFileSync(path.join(fx.dir, 'outside'), '')
    symlinkSync(path.join(fx.dir, 'outside'), path.join(fx.work, '.gitignore'))
    expect(() => ignorePath(fx.work, 'x')).toThrow(/symbolic link/)
    expect(readFileSync(path.join(fx.dir, 'outside'), 'utf8')).toBe('')
  })
})
