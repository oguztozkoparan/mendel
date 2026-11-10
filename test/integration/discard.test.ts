import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stashAction } from '../../src/main/git/branch'
import { applyHunk, discardAll, discardPaths, getDiff } from '../../src/main/git/changes'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)

describe('discard', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const read = (f: string) => readFileSync(path.join(fx.work, f), 'utf8')

  it('works on an unborn branch (no commits yet): staged and untracked files are removed', async () => {
    fx = createRepoFixture()
    const repo = path.join(fx.dir, 'fresh')
    fx.git(['init', '-q', repo])
    writeFileSync(path.join(repo, 'staged.txt'), 's\n')
    writeFileSync(path.join(repo, 'loose.txt'), 'l\n')
    fx.git(['add', 'staged.txt'], repo)
    await discardPaths(repo, ['staged.txt', 'loose.txt'], fx.env)
    expect(existsSync(path.join(repo, 'staged.txt'))).toBe(false)
    expect(existsSync(path.join(repo, 'loose.txt'))).toBe(false)
    expect(fx.git(['status', '--porcelain'], repo)).toBe('')
  })

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
  it('discard all: backs everything up in a "Discarded changes" stash, keeps untracked and ignored files unless opted in', async () => {
    fx = createRepoFixture()
    fx.commitFile('.gitignore', 'build/\n')
    fx.commitFile('gone.txt', 'g\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'staged\n')
    fx.git(['add', 'README.md'])
    writeFileSync(path.join(fx.work, 'README.md'), 'staged then edited\n')
    rmSync(path.join(fx.work, 'gone.txt'))
    writeFileSync(path.join(fx.work, 'added.txt'), 'a\n')
    fx.git(['add', 'added.txt'])
    writeFileSync(path.join(fx.work, 'loose.txt'), 'l\n')
    mkdirSync(path.join(fx.work, 'build'))
    writeFileSync(path.join(fx.work, 'build', 'out.o'), 'o\n')

    const sha = await discardAll(fx.work, null, false, fx.env)
    expect(read('README.md')).toBe('# fixture\n')
    expect(read('gone.txt')).toBe('g\n')
    expect(existsSync(path.join(fx.work, 'added.txt'))).toBe(false)
    expect(fx.git(['status', '--porcelain'])).toBe('?? loose.txt')
    expect(fx.git(['stash', 'list', '--format=%H %gs'])).toMatch(new RegExp(`^${sha} On main: Discarded changes \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d$`))

    // Opt in: untracked files go into the backup too; ignored ones stay.
    const loose = await discardAll(fx.work, null, true, fx.env)
    expect(existsSync(path.join(fx.work, 'loose.txt'))).toBe(false)
    expect(read('build/out.o')).toBe('o\n')
    expect(fx.git(['status', '--porcelain'])).toBe('')
    expect(await discardAll(fx.work, null, true, fx.env)).toBeNull()

    // Both backups restore (newest first).
    expect(fx.git(['rev-parse', 'stash@{0}'])).toBe(loose)
    fx.git(['stash', 'pop', '-q'])
    expect(read('loose.txt')).toBe('l\n')
    expect(fx.git(['rev-parse', 'stash@{0}'])).toBe(sha)
    fx.git(['stash', 'pop', '-q'])
    expect(read('README.md')).toBe('staged then edited\n')
    expect(existsSync(path.join(fx.work, 'gone.txt'))).toBe(false)
    expect(read('added.txt')).toBe('a\n')
  })

  it('discard all limited to paths keeps the other changes; only-untracked without opt-in is a no-op', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n')
    writeFileSync(path.join(fx.work, 'a.txt'), 'changed\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
    writeFileSync(path.join(fx.work, 'loose.txt'), 'l\n')
    expect(await discardAll(fx.work, ['loose.txt'], false, fx.env)).toBeNull()
    expect(await discardAll(fx.work, ['a.txt', 'loose.txt'], true, fx.env)).toMatch(/^[0-9a-f]{40}$/)
    expect(read('a.txt')).toBe('a\n')
    expect(existsSync(path.join(fx.work, 'loose.txt'))).toBe(false)
    expect(fx.git(['status', '--porcelain'])).toBe('M README.md')
  })

  it('discard all is refused during a merge in progress and changes nothing', async () => {
    fx = createRepoFixture()
    fx.git(['checkout', '-q', '-b', 'other'])
    fx.commitFile('README.md', 'theirs\n')
    fx.git(['checkout', '-q', 'main'])
    fx.commitFile('README.md', 'ours\n')
    expect(() => fx.git(['merge', '-q', 'other'])).toThrow()
    await expect(discardAll(fx.work, null, true, fx.env)).rejects.toThrow('A merge is in progress')
    expect(fx.git(['stash', 'list'])).toBe('')
    expect(fx.git(['status', '--porcelain'])).toBe('UU README.md')
  })

  it('undo of discard all restores the staged state (stash pop --index)', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n')
    writeFileSync(path.join(fx.work, 'a.txt'), 'staged\n')
    fx.git(['add', 'a.txt'])
    writeFileSync(path.join(fx.work, 'a.txt'), 'staged then edited\n')
    const sha = (await discardAll(fx.work, null, false, fx.env))!
    expect(fx.git(['status', '--porcelain'])).toBe('')
    expect(await stashAction(fx.work, sha, 'pop', fx.env, true)).toBe('ok')
    expect(fx.git(['status', '--porcelain'])).toBe('MM a.txt')
    expect(fx.git(['show', ':a.txt'])).toBe('staged')
    expect(read('a.txt')).toBe('staged then edited\n')
  })
})
