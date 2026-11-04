import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fetch, pull, push, syncState } from '../../src/main/git/sync'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('sync', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  /** Commit `name` from a second clone and push it, so origin is ahead of work/. */
  const pushFromOther = (name: string, content = `${name}\n`) => {
    const other = path.join(fx.dir, 'other')
    const g = (args: string[]) => execFileSync('git', args, { cwd: other, env: fx.env, stdio: 'pipe' })
    try {
      g(['pull', '-q'])
    } catch {
      execFileSync('git', ['clone', '-q', fx.remote, other], { cwd: fx.dir, env: fx.env, stdio: 'pipe' })
    }
    writeFileSync(path.join(other, name), content)
    g(['add', name])
    g(['commit', '-q', '-m', `remote ${name}`])
    g(['push', '-q'])
  }

  it('ahead 1 -> push -> remote has commit, ahead 0', async () => {
    fx = createRepoFixture()
    const sha = fx.commitFile('a.txt', 'a\n')
    expect(await syncState(fx.work, fx.env)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, remote: 'origin' })
    expect(await push(fx.work, { env: fx.env })).toBe('ok')
    expect(fx.git(['rev-parse', 'main'], fx.remote)).toBe(sha)
    expect(await syncState(fx.work, fx.env)).toMatchObject({ ahead: 0 })
  })

  it('remote ahead -> fetch shows behind -> pull brings commits', async () => {
    fx = createRepoFixture()
    pushFromOther('r.txt')
    expect(await syncState(fx.work, fx.env)).toMatchObject({ behind: 0, lastFetched: null })
    await fetch(fx.work, { env: fx.env })
    const s = await syncState(fx.work, fx.env)
    expect(s.behind).toBe(1)
    expect(s.lastFetched).toBeGreaterThan(Date.now() - 60_000)
    expect(await pull(fx.work, false, { env: fx.env })).toBe('ok')
    expect(fx.git(['log', '-1', '--format=%s'])).toBe('remote r.txt')
  })

  it('diverged push is rejected; pull merges', async () => {
    fx = createRepoFixture()
    pushFromOther('r.txt')
    fx.commitFile('a.txt', 'a\n')
    expect(await push(fx.work, { env: fx.env })).toBe('rejected')
    expect(await pull(fx.work, false, { env: fx.env })).toBe('ok')
    expect(await push(fx.work, { env: fx.env })).toBe('ok')
  })

  it('pull with conflicting changes reports conflict', async () => {
    fx = createRepoFixture()
    pushFromOther('README.md', 'theirs\n')
    fx.commitFile('README.md', 'ours\n')
    expect(await pull(fx.work, false, { env: fx.env })).toBe('conflict')
    expect(fx.git(['status', '--porcelain'])).toContain('UU README.md')
  })

  it('no upstream -> publish sets upstream', async () => {
    fx = createRepoFixture()
    fx.git(['switch', '-q', '-c', 'feature'])
    expect(await syncState(fx.work, fx.env)).toMatchObject({ branch: 'feature', upstream: null, remote: 'origin' })
    expect(await push(fx.work, { env: fx.env })).toBe('ok')
    expect(fx.git(['rev-parse', '--abbrev-ref', 'feature@{u}'])).toBe('origin/feature')
  })

  it('no remote', async () => {
    fx = createRepoFixture()
    fx.git(['remote', 'remove', 'origin'])
    expect(await syncState(fx.work, fx.env)).toMatchObject({ remote: null })
    await expect(fetch(fx.work, { env: fx.env })).rejects.toThrow('no remote')
  })
})
