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
})
