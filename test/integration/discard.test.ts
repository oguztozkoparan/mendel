import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyHunk, discardPaths, getDiff } from '../../src/main/git/changes'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)

describe('discard', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const read = (f: string) => readFileSync(path.join(fx.work, f), 'utf8')

  it('restores modified/deleted/renamed files and removes untracked and added ones', async () => {
    fx = createRepoFixture()
    fx.commitFile('gone.txt', 'g\n')
    fx.commitFile('old.txt', 'o\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
    fx.git(['add', 'README.md'])
    writeFileSync(path.join(fx.work, 'README.md'), 'changed again\n')
    rmSync(path.join(fx.work, 'gone.txt'))
    writeFileSync(path.join(fx.work, 'untracked.txt'), 'u\n')
    writeFileSync(path.join(fx.work, 'added.txt'), 'a\n')
    fx.git(['add', 'added.txt'])
    fx.git(['mv', 'old.txt', 'new.txt'])
    writeFileSync(path.join(fx.work, 'keep.txt'), 'k\n')
    await discardPaths(fx.work, ['README.md', 'gone.txt', 'untracked.txt', 'added.txt', 'new.txt'], fx.env)
    expect(read('README.md')).toBe('# fixture\n')
    expect(read('gone.txt')).toBe('g\n')
    expect(read('old.txt')).toBe('o\n')
    expect(existsSync(path.join(fx.work, 'new.txt'))).toBe(false)
    expect(existsSync(path.join(fx.work, 'untracked.txt'))).toBe(false)
    expect(existsSync(path.join(fx.work, 'added.txt'))).toBe(false)
    expect(fx.git(['status', '--porcelain'])).toBe('?? keep.txt')
  })

  it('discards only the chosen hunk', async () => {
    fx = createRepoFixture()
    fx.commitFile('f.txt', LINES.join('\n') + '\n')
    writeFileSync(path.join(fx.work, 'f.txt'), LINES.map((l, i) => (i === 1 ? 'first' : i === 25 ? 'second' : l)).join('\n') + '\n')
    const [first] = (await getDiff(fx.work, { path: 'f.txt', staged: false, untracked: false }, fx.env)).split('\n').filter((l) => l.startsWith('@@'))
    await applyHunk(fx.work, { path: 'f.txt', untracked: false }, first!, 'discard', fx.env)
    expect(read('f.txt')).toContain('line 1\n')
    expect(read('f.txt')).toContain('second\n')
  })
})
