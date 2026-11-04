import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyBranchStash, createBranch, deleteBranch, listBranches, parseTrack, stashAndSwitch, switchBranch, validateBranchName } from '../../src/main/git/branch'
import { rebaseOntoUpstream } from '../../src/main/git/sync'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('parseTrack', () => {
  it('reads ahead/behind/gone', () => {
    expect(parseTrack('ahead 1, behind 2')).toEqual({ ahead: 1, behind: 2 })
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0 })
  })
})

describe('branches', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const head = () => fx.git(['branch', '--show-current'])
  const read = (f: string) => readFileSync(path.join(fx.work, f), 'utf8')

  it('validates names with check-ref-format and rejects option-like names', async () => {
    fx = createRepoFixture()
    expect(await validateBranchName(fx.work, 'feat/x', fx.env)).toBe('feat/x')
    for (const bad of ['-x', '--force', 'a..b', 'a b', '@{-1}', 'x.lock', ''])
      await expect(validateBranchName(fx.work, bad, fx.env)).rejects.toThrow('Invalid branch name')
  })

  it('creates from current and switches with a clean tree', async () => {
    fx = createRepoFixture()
    await createBranch(fx.work, 'feature', undefined, fx.env)
    expect(head()).toBe('feature')
    expect(await switchBranch(fx.work, 'main', fx.env)).toBe('ok')
    expect(head()).toBe('main')
    const b = await listBranches(fx.work, fx.env)
    expect(b.current).toBe('main')
    expect(b.local.map((x) => x.name)).toEqual(['main', 'feature'])
    expect(b.local[0]).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 })
    expect(b.remote).toEqual(['origin/main'])
  })

  it('reports ahead count and switches to a remote branch by tracking it', async () => {
    fx = createRepoFixture()
    fx.git(['push', '-q', 'origin', 'main:other'])
    fx.git(['fetch', '-q'])
    fx.commitFile('a.txt', 'a\n')
    expect((await listBranches(fx.work, fx.env)).local[0]).toMatchObject({ name: 'main', ahead: 1 })
    expect(await switchBranch(fx.work, 'origin/other', fx.env)).toBe('ok')
    expect(head()).toBe('other')
    expect(fx.git(['rev-parse', '--abbrev-ref', 'other@{u}'])).toBe('origin/other')
  })

  it('unknown branches are refused', async () => {
    fx = createRepoFixture()
    await expect(switchBranch(fx.work, 'nope', fx.env)).rejects.toThrow('Unknown branch')
    await expect(createBranch(fx.work, 'x', '--orphan', fx.env)).rejects.toThrow('Unknown branch')
  })

  it('conflicting dirty tree -> dirty; stash & switch; restore on return', async () => {
    fx = createRepoFixture()
    fx.git(['switch', '-q', '-c', 'other'])
    fx.commitFile('README.md', 'other\n')
    fx.git(['switch', '-q', 'main'])
    writeFileSync(path.join(fx.work, 'README.md'), 'local edit\n')
    expect(await switchBranch(fx.work, 'other', fx.env)).toBe('dirty')
    expect(head()).toBe('main')
    await stashAndSwitch(fx.work, 'other', fx.env)
    expect(head()).toBe('other')
    expect(read('README.md')).toBe('other\n')
    expect((await listBranches(fx.work, fx.env)).stash).toBe(false)
    await switchBranch(fx.work, 'main', fx.env)
    expect((await listBranches(fx.work, fx.env)).stash).toBe(true)
    await applyBranchStash(fx.work, 'restore', fx.env)
    expect(read('README.md')).toBe('local edit\n')
    expect((await listBranches(fx.work, fx.env)).stash).toBe(false)
  })

  it('non-conflicting changes come along on switch', async () => {
    fx = createRepoFixture()
    fx.git(['branch', 'other'])
    writeFileSync(path.join(fx.work, 'README.md'), 'carried\n')
    expect(await switchBranch(fx.work, 'other', fx.env)).toBe('ok')
    expect(read('README.md')).toBe('carried\n')
  })

  it('deletes non-current branches; unmerged needs force; current is refused', async () => {
    fx = createRepoFixture()
    fx.git(['branch', 'merged'])
    fx.git(['switch', '-q', '-c', 'unmerged'])
    fx.commitFile('u.txt', 'u\n')
    fx.git(['switch', '-q', 'main'])
    expect(await deleteBranch(fx.work, 'merged', false, fx.env)).toBe('ok')
    expect(await deleteBranch(fx.work, 'unmerged', false, fx.env)).toBe('unmerged')
    expect(await deleteBranch(fx.work, 'unmerged', true, fx.env)).toBe('ok')
    await expect(deleteBranch(fx.work, 'main', true, fx.env)).rejects.toThrow('current branch')
    expect(fx.git(['branch', '--format=%(refname:short)'])).toBe('main')
  })

  it('detached HEAD has no current branch but a short sha', async () => {
    fx = createRepoFixture()
    fx.git(['switch', '-q', '--detach'])
    const b = await listBranches(fx.work, fx.env)
    expect(b.current).toBeNull()
    expect(b.head).toBe(fx.git(['rev-parse', '--short', 'HEAD']))
  })
})

describe('git calls per op', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  /** Run `op` with GIT_TRACE and count how often git ran `sub` (e.g. for-each-ref = one listBranches). */
  const count = async (sub: string, op: (env: NodeJS.ProcessEnv) => Promise<unknown>) => {
    const trace = path.join(fx.dir, `trace-${sub}-${Math.random()}`)
    await op({ ...fx.env, GIT_TRACE: trace })
    return readFileSync(trace, 'utf8').split('\n').filter((l) => l.includes(`built-in: git ${sub}`)).length
  }

  it('reuses already-read branch/sync state instead of re-reading it', async () => {
    fx = createRepoFixture()
    fx.git(['branch', 'other'])
    expect(await count('for-each-ref', (env) => switchBranch(fx.work, 'other', env))).toBe(1)
    expect(await count('for-each-ref', (env) => deleteBranch(fx.work, 'main', false, env))).toBe(1)
    fx.git(['switch', '-q', '-c', 'main', '--track', 'origin/main'])
    expect(await count('for-each-ref', (env) => rebaseOntoUpstream(fx.work, false, { env }))).toBe(1)
  })
})
