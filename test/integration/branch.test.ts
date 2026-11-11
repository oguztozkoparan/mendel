import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyBranchStash, checkoutRef, createBranch, deleteBranch, listBranches, listStashes, parseTrack, stashAction, stashAndSwitch, switchBranch, validateBranchName } from '../../src/main/git/branch'
import type { StashEntry } from '../../src/shared/ipc'
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

  it('lists stashes; apply / pop / drop by sha, unknown sha refused', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'README.md'), 'one\n')
    fx.git(['stash', 'push', '-q', '-m', 'first'])
    writeFileSync(path.join(fx.work, 'README.md'), 'two\n')
    fx.git(['stash', 'push', '-q', '-m', 'second'])
    const list = await listStashes(fx.work, fx.env)
    expect(list.map((x) => x.message)).toEqual(['On main: second', 'On main: first'])
    const [second, first] = list as [StashEntry, StashEntry]
    expect(second.sha).toBe(fx.git(['rev-parse', 'stash@{0}']))
    await expect(stashAction(fx.work, 'deadbeef', 'drop', fx.env)).rejects.toThrow('Unknown stash')
    // Entry 1 by sha, not by index: apply keeps it, pop removes it.
    await stashAction(fx.work, first.sha, 'apply', fx.env)
    expect(read('README.md')).toBe('one\n')
    expect(await listStashes(fx.work, fx.env)).toHaveLength(2)
    fx.git(['checkout', '-q', '--', 'README.md'])
    await stashAction(fx.work, first.sha, 'pop', fx.env)
    expect(read('README.md')).toBe('one\n')
    expect((await listStashes(fx.work, fx.env)).map((x) => x.sha)).toEqual([second.sha])
    expect(await stashAction(fx.work, second.sha, 'drop', fx.env)).toBe('ok')
    expect(await listStashes(fx.work, fx.env)).toEqual([])
  })

  it('apply / pop conflicting with HEAD -> conflict, unmerged file, pop keeps the stash', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'README.md'), 'stashed\n')
    fx.git(['stash', 'push', '-q'])
    fx.commitFile('README.md', 'committed\n')
    const [entry] = (await listStashes(fx.work, fx.env)) as [StashEntry]
    for (const action of ['apply', 'pop'] as const) {
      expect(await stashAction(fx.work, entry.sha, action, fx.env)).toBe('conflict')
      expect(fx.git(['ls-files', '--unmerged'])).toContain('README.md')
      expect(await listStashes(fx.work, fx.env)).toHaveLength(1)
      fx.git(['reset', '-q', '--hard'])
    }
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

describe('checkoutRef', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('fetches a branch ref into a new local branch tracking it; replace and stash are asked', async () => {
    fx = createRepoFixture()
    // remote `feature` one commit ahead of main; local `feature` stays on main; no remote-tracking ref yet
    fx.git(['branch', 'feature'])
    const sha = fx.commitFile('README.md', 'feature\n', 'Feature')
    fx.git(['push', '-q', 'origin', 'HEAD:refs/heads/feature'])
    fx.git(['reset', '-q', '--hard', 'origin/main'])
    fx.git(['update-ref', '-d', 'refs/remotes/origin/feature'])
    const main = fx.git(['rev-parse', 'main'])

    // pinned: a plain `git fetch origin refs/heads/feature` updates refs/remotes/origin/feature (opportunistic update)
    fx.git(['fetch', '-q', 'origin', 'refs/heads/feature'])
    expect(fx.git(['rev-parse', 'refs/remotes/origin/feature'])).toBe(sha)
    fx.git(['update-ref', '-d', 'refs/remotes/origin/feature'])

    const asked: string[] = []
    const ask = async (q: 'replace' | 'stash') => (asked.push(q), true)
    expect(await checkoutRef(fx.work, 'origin', 'refs/heads/feature', 'pr/1', 'origin/feature', ask, fx.env)).toBe('pr/1')
    expect(fx.git(['branch', '--show-current'])).toBe('pr/1')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)
    expect(fx.git(['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe('origin/feature')
    expect(fx.git(['rev-parse', 'feature'])).toBe(main)
    expect(asked).toEqual([])

    fx.git(['switch', '-q', 'main'])
    expect(await checkoutRef(fx.work, 'origin', 'refs/heads/feature', 'pr/1', 'origin/feature', async (q) => (asked.push(q), false), fx.env)).toBeNull()
    expect(asked).toEqual(['replace'])
    expect(fx.git(['branch', '--show-current'])).toBe('main')

    fx.git(['branch', '-q', '-D', 'pr/1'])
    writeFileSync(path.join(fx.work, 'README.md'), 'local edit\n')
    expect(await checkoutRef(fx.work, 'origin', 'refs/heads/feature', 'pr/1', 'origin/feature', ask, fx.env)).toBe('pr/1')
    expect(asked).toEqual(['replace', 'stash'])
    expect(fx.git(['stash', 'list', '--format=%gs'])).toBe('On main: mendel-stash')
  })

  it('rejects an invalid branch name or option-like ref', async () => {
    fx = createRepoFixture()
    const ask = async () => true
    await expect(checkoutRef(fx.work, 'origin', 'refs/heads/main', '-x', null, ask, fx.env)).rejects.toThrow('Invalid branch name')
    await expect(checkoutRef(fx.work, 'origin', '-', 'pr/1', null, ask, fx.env)).rejects.toThrow('Invalid argument')
  })
})
