import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { applyHunk, getDiff, hunkPatch, stagePaths, unstagePaths } from '../../src/main/git/changes'
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
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'gitdock-unborn-')))
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
