import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDiff, getStatus, parseStatus } from '../../src/main/git/changes'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('parseStatus', () => {
  it('parses ordinary, rename, unmerged and untracked entries', () => {
    const out = [
      '1 .M N... 100644 100644 100644 abc abc a b.txt',
      '2 R. N... 100644 100644 100644 abc abc R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? new.txt',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual([
      { path: 'a b.txt', staged: null, unstaged: 'M', conflicted: false },
      { path: 'new name.txt', origPath: 'old name.txt', staged: 'R', unstaged: null, conflicted: false },
      { path: 'conflict.txt', staged: null, unstaged: 'U', conflicted: true },
      { path: 'new.txt', staged: null, unstaged: '?', conflicted: false }
    ])
  })
})

describe('status and diff against a real repo', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('reports modified, added, deleted and renamed files', async () => {
    fx = createRepoFixture()
    fx.commitFile('gone.txt', 'x\n')
    fx.commitFile('old.txt', 'rename me\n')
    writeFileSync(path.join(fx.work, 'README.md'), '# changed\n')
    writeFileSync(path.join(fx.work, 'new file.txt'), 'hello\n')
    rmSync(path.join(fx.work, 'gone.txt'))
    fx.git(['mv', 'old.txt', 'renamed.txt'])
    const byPath = Object.fromEntries((await getStatus(fx.work, fx.env)).map((f) => [f.path, f]))
    expect(byPath['README.md']).toMatchObject({ staged: null, unstaged: 'M' })
    expect(byPath['new file.txt']).toMatchObject({ staged: null, unstaged: '?' })
    expect(byPath['gone.txt']).toMatchObject({ staged: null, unstaged: 'D' })
    expect(byPath['renamed.txt']).toMatchObject({ staged: 'R', origPath: 'old.txt' })
  })

  it('diffs unstaged, staged, untracked and binary files', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'README.md'), '# fixture\nmore\n')
    expect(await getDiff(fx.work, { path: 'README.md', staged: false, untracked: false }, fx.env)).toContain('+more')
    fx.git(['add', 'README.md'])
    expect(await getDiff(fx.work, { path: 'README.md', staged: true, untracked: false }, fx.env)).toContain('+more')
    expect(await getDiff(fx.work, { path: 'README.md', staged: false, untracked: false }, fx.env)).toBe('')

    writeFileSync(path.join(fx.work, '*.txt'), 'literal\n')
    writeFileSync(path.join(fx.work, 'other.txt'), 'other\n')
    const untracked = await getDiff(fx.work, { path: '*.txt', staged: false, untracked: true }, fx.env)
    expect(untracked).toContain('+++ b/*.txt')
    expect(untracked).toContain('+literal')

    writeFileSync(path.join(fx.work, 'img.bin'), Buffer.from([0, 1, 2, 0, 255]))
    expect(await getDiff(fx.work, { path: 'img.bin', staged: false, untracked: true }, fx.env)).toMatch(/^Binary files /m)
  })

  it('staged rename diff names both paths', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'one\ntwo\nthree\n')
    renameSync(path.join(fx.work, 'a.txt'), path.join(fx.work, 'b.txt'))
    fx.git(['add', '-A'])
    expect(await getDiff(fx.work, { path: 'b.txt', origPath: 'a.txt', staged: true, untracked: false }, fx.env)).toContain('rename from a.txt')
  })
})
