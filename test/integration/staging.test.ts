import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { applyHunk, getDiff, hunkPatch, linesPatch, stagePaths, unstagePaths } from '../../src/main/git/changes'
import { invoke } from '../../src/shared/ipc'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'
import { isolatedGitEnv } from '../fixtures/git-env'

const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)
const twoHunks = () => LINES.map((l, i) => (i === 1 ? 'first change' : i === 25 ? 'second change' : l)).join('\n') + '\n'
const headers = (diff: string) => diff.split('\n').filter((l) => l.startsWith('@@'))

describe('hunkPatch', () => {
  it('keeps the file header and only the chosen hunk', () => {
    const diff = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n'
    expect(hunkPatch(diff, '@@ -9 +9 @@')).toBe('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -9 +9 @@\n-c\n+d\n')
    expect(hunkPatch(diff, '@@ -1 +1 @@')).toBe('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n')
    expect(hunkPatch(diff, '@@ -5 +5 @@')).toBeNull()
  })
})

describe('staging', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const cached = () => fx.git(['diff', '--cached', '--name-only'])

  it('stage all / unstage all without a path list (also before the first commit)', async () => {
    fx = createRepoFixture()
    const repo = path.join(fx.dir, 'fresh')
    fx.git(['init', '-q', repo])
    for (let i = 0; i < 3; i++) writeFileSync(path.join(repo, `f${i}.txt`), `${i}\n`)
    await stagePaths(repo, null, fx.env)
    expect(fx.git(['diff', '--cached', '--name-only'], repo)).toBe('f0.txt\nf1.txt\nf2.txt')
    await unstagePaths(repo, null, fx.env)
    expect(fx.git(['status', '--porcelain'], repo)).toBe('?? f0.txt\n?? f1.txt\n?? f2.txt')
    // The IPC contract takes `all` instead of more than 100k paths.
    expect(invoke['changes:stage'].req.parse({ repo: 'r', all: true })).toEqual({ repo: 'r', all: true })
    expect(() => invoke['changes:stage'].req.parse({ repo: 'r', paths: Array.from({ length: 100_001 }, (_, i) => `f${i}`) })).toThrow()
  })

  it('stages and unstages files, including deletions and renames', async () => {
    fx = createRepoFixture()
    fx.commitFile('old.txt', 'x\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
    writeFileSync(path.join(fx.work, 'new.txt'), 'n\n')
    await stagePaths(fx.work, ['README.md', 'new.txt'], fx.env)
    expect(cached()).toBe('README.md\nnew.txt')
    await unstagePaths(fx.work, ['README.md'], fx.env)
    expect(cached()).toBe('new.txt')
    fx.git(['mv', 'old.txt', 'moved.txt'])
    await unstagePaths(fx.work, ['old.txt', 'moved.txt', 'new.txt'], fx.env)
    expect(cached()).toBe('')
  })

  it('unstages before the first commit', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mendel-unborn-')))
    const env = isolatedGitEnv(dir)
    execFileSync('git', ['init', '-q', dir], { env })
    writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    await stagePaths(dir, ['a.txt'], env)
    await unstagePaths(dir, ['a.txt'], env)
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, env, encoding: 'utf8' })).toBe('')
  })

  it('stages one hunk of a two-hunk file and unstages it again', async () => {
    fx = createRepoFixture()
    fx.commitFile('f.txt', LINES.join('\n') + '\n')
    writeFileSync(path.join(fx.work, 'f.txt'), twoHunks())
    const t = { path: 'f.txt', untracked: false }
    const [first, second] = headers(await getDiff(fx.work, { ...t, staged: false }, fx.env))
    await applyHunk(fx.work, t, first!, 'stage', fx.env)
    const index = fx.git(['diff', '--cached'])
    expect(index).toContain('+first change')
    expect(index).not.toContain('second change')
    expect(fx.git(['diff'])).toContain('+second change')
    expect(second).toBeDefined()

    const [stagedHunk] = headers(await getDiff(fx.work, { ...t, staged: true }, fx.env))
    await applyHunk(fx.work, t, stagedHunk!, 'unstage', fx.env)
    expect(cached()).toBe('')
    await expect(applyHunk(fx.work, t, '@@ -99,1 +99,1 @@', 'stage', fx.env)).rejects.toThrow(/changed/)
  })

  it('stages a hunk of an untracked file', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'new.txt'), 'hello\n')
    const [h] = headers(await getDiff(fx.work, { path: 'new.txt', staged: false, untracked: true }, fx.env))
    await applyHunk(fx.work, { path: 'new.txt', untracked: true }, h!, 'stage', fx.env)
    expect(cached()).toBe('new.txt')
  })
})

describe('linesPatch', () => {
  const H = 'diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n'
  const mixed = H + '@@ -1,3 +1,3 @@ fn\n a\n-b\n-c\n+B\n+C\n'
  const at = '@@ -1,3 +1,3 @@ fn'

  it('stage: unpicked deletions become context, unpicked additions are dropped', () => {
    expect(linesPatch(mixed, at, [1, 3], false)).toBe(H + '@@ -1,3 +1,3 @@ fn\n a\n-b\n+B\n c\n')
    expect(linesPatch(mixed, at, [2, 4], false)).toBe(H + '@@ -1,3 +1,3 @@ fn\n a\n b\n-c\n+C\n')
    expect(linesPatch(mixed, at, [3, 4], false)).toBe(H + '@@ -1,3 +1,5 @@ fn\n a\n b\n c\n+B\n+C\n')
    expect(linesPatch(mixed, at, [2], false)).toBe(H + '@@ -1,3 +1,2 @@ fn\n a\n b\n-c\n')
  })

  it('unstage (reverse): unpicked additions become context, unpicked deletions are dropped', () => {
    expect(linesPatch(mixed, at, [1, 3], true)).toBe(H + '@@ -1,3 +1,3 @@ fn\n a\n-b\n+B\n C\n')
    expect(linesPatch(mixed, at, [2, 4], true)).toBe(H + '@@ -1,3 +1,3 @@ fn\n a\n B\n-c\n+C\n')
  })

  it('returns null when nothing changes or the hunk is gone', () => {
    expect(linesPatch(mixed, at, [0], false)).toBeNull()
    expect(linesPatch(mixed, at, [99], false)).toBeNull()
    expect(linesPatch(mixed, '@@ -7 +7 @@', [1], false)).toBeNull()
  })

  it('keeps no-newline markers with their line; a kept last line gains its newline when lines follow it', () => {
    const d = H + '@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n\\ No newline at end of file\n'
    expect(linesPatch(d, '@@ -1,2 +1,3 @@', [3], false)).toBe(H + '@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n\\ No newline at end of file\n')
    expect(linesPatch(d, '@@ -1,2 +1,3 @@', [1], false)).toBe(H + '@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n')
  })

  it('turns an added file into a modification when unstaging only some of its lines', () => {
    const d = 'diff --git a/n b/n\nnew file mode 100644\nindex 0..1\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+x\n+y\n'
    expect(linesPatch(d, '@@ -0,0 +1,2 @@', [1], true)).toBe('diff --git a/n b/n\nindex 0..1\n--- a/n\n+++ b/n\n@@ -1,1 +1,2 @@\n x\n+y\n')
    expect(linesPatch(d, '@@ -0,0 +1,2 @@', [0, 1], true)).toBe(d)
  })
})

describe('line staging', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const t = { path: 'f.txt', untracked: false }
  const index = () => execFileSync('git', ['show', ':f.txt'], { cwd: fx.work, env: fx.env, encoding: 'utf8' })
  /** Stage, unstage or discard the change lines whose text is in `texts`, in the file's only hunk. */
  const apply = async (action: 'stage' | 'unstage' | 'discard', texts: string[]) => {
    const diff = await getDiff(fx.work, { ...t, staged: action === 'unstage' }, fx.env)
    const [h] = headers(diff)
    const body = diff.slice(diff.indexOf(h!)).split('\n').slice(1).filter((l) => l && !l.startsWith('\\'))
    const picked = body.flatMap((l, i) => (texts.includes(l) ? [i] : []))
    await applyHunk(fx.work, t, h!, action, fx.env, picked, picked.map((i) => body[i]!))
  }
  const setup = (before: string, after: string) => {
    fx = createRepoFixture()
    fx.commitFile('f.txt', before)
    writeFileSync(path.join(fx.work, 'f.txt'), after)
  }

  it('stages and unstages single additions', async () => {
    setup('a\nb\n', 'a\nx\nb\ny\n')
    await apply('stage', ['+y'])
    expect(index()).toBe('a\nb\ny\n')
    await apply('stage', ['+x'])
    expect(index()).toBe('a\nx\nb\ny\n')
    await apply('unstage', ['+y'])
    expect(index()).toBe('a\nx\nb\n')
  })

  it('stages and unstages single deletions', async () => {
    setup('a\nb\nc\n', 'a\n')
    await apply('stage', ['-c'])
    expect(index()).toBe('a\nb\n')
    await apply('stage', ['-b'])
    expect(index()).toBe('a\n')
    await apply('unstage', ['-b'])
    expect(index()).toBe('a\nb\n')
  })

  it('stages and unstages part of a replacement', async () => {
    setup('a\nb\nc\n', 'a\nB\nC\n')
    await apply('stage', ['-b', '+B'])
    expect(index()).toBe('a\nB\nc\n')
    await apply('stage', ['-c', '+C'])
    expect(index()).toBe('a\nB\nC\n')
    await apply('unstage', ['-c', '+C'])
    expect(index()).toBe('a\nB\nc\n')
  })

  it('handles a missing newline at end of file', async () => {
    setup('a\nb', 'a\nb\nc')
    await apply('stage', ['+c'])
    expect(index()).toBe('a\nb\nc')
    fx.git(['reset', '-q'])
    await apply('stage', ['+b'])
    expect(index()).toBe('a\nb\nb\n')
    fx.git(['reset', '-q'])
    await apply('stage', ['-b'])
    expect(index()).toBe('a\n')
    await apply('unstage', ['-b'])
    expect(index()).toBe('a\nb')
  })

  it('keeps a picked no-newline line last on its side', async () => {
    setup('a\nb\n', 'c')
    await apply('stage', ['-a', '+c'])
    expect(index()).toBe('b\nc')

    fx.git(['reset', '-q', '--hard'])
    fx.commitFile('f.txt', 'x')
    writeFileSync(path.join(fx.work, 'f.txt'), 'b\n')
    fx.git(['add', 'f.txt'])
    await apply('unstage', ['-x'])
    expect(index()).toBe('b\nx')

    fx.git(['reset', '-q', '--hard'])
    fx.commitFile('f.txt', 'y')
    writeFileSync(path.join(fx.work, 'f.txt'), 'b\n')
    await apply('discard', ['-y'])
    expect(readFileSync(path.join(fx.work, 'f.txt'), 'utf8')).toBe('b\ny')
  })

  it('refuses when the picked lines are no longer those lines', async () => {
    setup('a\nb\n', 'a\nB\n')
    const [h] = headers(await getDiff(fx.work, { ...t, staged: false }, fx.env))
    writeFileSync(path.join(fx.work, 'f.txt'), 'a\nC\n')
    await expect(applyHunk(fx.work, t, h!, 'stage', fx.env, [2], ['+B'])).rejects.toThrow(/changed/)
    expect(index()).toBe('a\nb\n')
    await applyHunk(fx.work, t, h!, 'stage', fx.env, [2], ['+C'])
    expect(index()).toBe('a\nb\nC\n')
    const req = { repo: 'r', path: 'f.txt', untracked: false, hunk: h!, action: 'stage' }
    expect(() => invoke['changes:applyHunk'].req.parse({ ...req, lines: [1] })).toThrow()
    expect(() => invoke['changes:applyHunk'].req.parse({ ...req, lines: [1], texts: ['+B', '-b'] })).toThrow()
    expect(invoke['changes:applyHunk'].req.parse({ ...req, lines: [1], texts: ['+B'] })).toMatchObject({ texts: ['+B'] })
    expect(invoke['changes:applyHunk'].req.parse(req)).toEqual(req)
  })

  it('unstages some lines of an added file and stages part of a deleted one', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'f.txt'), 'x\ny\n')
    fx.git(['add', 'f.txt'])
    await apply('unstage', ['+y'])
    expect(index()).toBe('x\n')
    fx.git(['add', 'f.txt'])
    fx.git(['commit', '-q', '-m', 'f'])
    rmSync(path.join(fx.work, 'f.txt'))
    await apply('stage', ['-y'])
    expect(index()).toBe('x\n')
    await apply('stage', ['-x'])
    expect(fx.git(['status', '--porcelain'])).toBe('D  f.txt')
  })
})
