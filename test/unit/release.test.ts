import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const script = path.resolve('scripts/release.mjs')
let repo: RepoFixture | undefined
afterEach(() => repo?.cleanup())

const release = (r: RepoFixture, ...args: string[]) => spawnSync('node', [script, ...args], { cwd: r.work, env: r.env, encoding: 'utf8' })

describe('scripts/release.mjs guards', () => {
  it('refuses bad bump, dirty tree and non-main branch before touching anything', () => {
    repo = createRepoFixture()
    expect(release(repo, 'huge').stderr).toContain('usage: npm run release')
    writeFileSync(path.join(repo.work, 'dirty'), 'x')
    expect(release(repo, 'patch').stderr).toContain('working tree is not clean')
    repo.git(['clean', '-fq'])
    repo.git(['switch', '-qc', 'topic'])
    const r = release(repo, 'patch')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('must be on main (on topic)')
  })

  it('refuses when HEAD differs from origin/main (R26)', () => {
    repo = createRepoFixture()
    repo.commitFile('local.txt', 'x\n') // ahead of origin/main
    const r = release(repo, 'patch')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('HEAD is not origin/main')
  })

  it('picks the bump from the commits since the last tag', () => {
    repo = createRepoFixture()
    repo.git(['tag', 'v1.0.0'])
    expect(release(repo).stderr).toContain('no feat/bug commits since v1.0.0')
    repo.commitFile('a.txt', 'x\n', 'bug(app): fix')
    repo.git(['push', '-q', 'origin', 'main'])
    expect(release(repo).stdout).toContain('release: patch bump (last tag v1.0.0)') // then stops: the fixture has no npm project
    repo.commitFile('b.txt', 'x\n', 'feat(app): add')
    repo.git(['push', '-q', 'origin', 'main'])
    expect(release(repo).stdout).toContain('release: minor bump')
    expect(release(repo, 'major').stdout).toContain('release: major bump')
    expect(repo.git(['tag'])).toBe('v1.0.0')
  })
})
