import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { getCommit, getCommitDiff, getLog } from '../../src/main/git/log'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('history', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('lists newest first with unpushed marks and pages', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n', 'second\n\nbody')
    const log = await getLog(fx.work, 0, fx.env)
    expect(log.map((c) => [c.summary, c.author, c.unpushed])).toEqual([
      ['second', 'Test User', true],
      ['initial commit', 'Test User', false]
    ])
    expect(log[0]!.date).toBeGreaterThan(Date.now() - 60_000)
    expect((await getLog(fx.work, 1, fx.env)).map((c) => c.summary)).toEqual(['initial commit'])
  })

  it('pages a 500-commit repo quickly', async () => {
    fx = createRepoFixture()
    // fast-import: 499 more commits without spawning git 500 times
    const stream = Array.from({ length: 499 }, (_, i) => `commit refs/heads/main\ncommitter T <t@e> ${1700000000 + i} +0000\ndata ${String(i).length + 2}\nc${i}\n\n${i === 0 ? 'from refs/heads/main^0\n' : ''}`).join('')
    execFileSync('git', ['fast-import', '--quiet'], { cwd: fx.work, env: fx.env, input: stream })
    const t = Date.now()
    const first = await getLog(fx.work, 0, fx.env)
    expect(Date.now() - t).toBeLessThan(1000)
    expect(first).toHaveLength(100)
    expect(first[0]!.summary).toBe('c498')
    expect(await getLog(fx.work, 400, fx.env)).toHaveLength(100)
    expect(await getLog(fx.work, 500, fx.env)).toHaveLength(0)
  })

  it('commit detail: message, files, per-file diff, root commit', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n')
    fx.git(['mv', 'a.txt', 'b.txt'])
    fx.commitFile('c.txt', 'c\n', 'rename and add\n\ndetails')
    const sha = fx.git(['rev-parse', 'HEAD'])
    const d = await getCommit(fx.work, sha, fx.env)
    expect(d).toMatchObject({ sha, message: 'rename and add\n\ndetails', author: 'Test User <test@example.com>' })
    expect(d.parents).toHaveLength(1)
    expect(d.files).toEqual([
      { status: 'R', origPath: 'a.txt', path: 'b.txt' },
      { status: 'A', path: 'c.txt' }
    ])
    expect(await getCommitDiff(fx.work, sha, { path: 'c.txt' }, fx.env)).toContain('+c')
    const root = fx.git(['rev-list', '--max-parents=0', 'HEAD'])
    expect((await getCommit(fx.work, root, fx.env)).files).toEqual([{ status: 'A', path: 'README.md' }])
    expect(await getCommitDiff(fx.work, root, { path: 'README.md' }, fx.env)).toContain('+# fixture')
  })

  it('empty repo has no commits', async () => {
    fx = createRepoFixture()
    fx.git(['checkout', '-q', '--orphan', 'fresh'])
    expect(await getLog(fx.work, 0, fx.env)).toEqual([])
  })
})
