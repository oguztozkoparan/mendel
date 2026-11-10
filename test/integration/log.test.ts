import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getBlame, getCommit, getCommitDiff, getLog, logFilterArgs } from '../../src/main/git/log'
import { parseHistoryQuery } from '../../src/shared/historyQuery'
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
    expect(log.map((c) => c.parents)).toEqual([[log[1]!.sha], []])
    expect((await getLog(fx.work, 1, fx.env)).map((c) => c.summary)).toEqual(['initial commit'])
  })

  it('lists another branch by full ref', async () => {
    fx = createRepoFixture()
    fx.git(['switch', '-q', '-c', 'other'])
    fx.commitFile('a.txt', 'a\n', 'on other')
    fx.git(['switch', '-q', 'main'])
    expect((await getLog(fx.work, 0, fx.env, undefined, { ref: 'refs/heads/other' })).map((c) => [c.summary, c.unpushed])).toEqual([
      ['on other', true],
      ['initial commit', false]
    ])
    expect((await getLog(fx.work, 0, fx.env)).map((c) => c.summary)).toEqual(['initial commit'])
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
    writeFileSync(join(fx.work, 'bin.dat'), Buffer.from([0, 1, 2, 0]))
    fx.git(['add', 'bin.dat'])
    fx.commitFile('c.txt', 'c\n', 'rename and add\n\ndetails')
    const sha = fx.git(['rev-parse', 'HEAD'])
    const d = await getCommit(fx.work, sha, fx.env)
    expect(d).toMatchObject({ sha, message: 'rename and add\n\ndetails', author: 'Test User <test@example.com>' })
    expect(d.parents).toHaveLength(1)
    expect(d.files).toEqual([
      { status: 'R', origPath: 'a.txt', path: 'b.txt', add: 0, del: 0 },
      { status: 'A', path: 'bin.dat' }, // binary: no counts
      { status: 'A', path: 'c.txt', add: 1, del: 0 }
    ])
    expect(await getCommitDiff(fx.work, sha, { path: 'c.txt' }, fx.env)).toContain('+c')
    const root = fx.git(['rev-list', '--max-parents=0', 'HEAD'])
    expect((await getCommit(fx.work, root, fx.env)).files).toEqual([{ status: 'A', path: 'README.md', add: 1, del: 0 }])
    expect(await getCommitDiff(fx.work, root, { path: 'README.md' }, fx.env)).toContain('+# fixture')
  })

  it('blame: per-line commit/author/date as of a commit', async () => {
    fx = createRepoFixture()
    const first = fx.commitFile('a.txt', 'one\ntwo\n')
    const second = fx.commitFile('a.txt', 'one\nTWO\nthree\n')
    const lines = await getBlame(fx.work, second, 'a.txt', fx.env)
    expect(lines.map((l) => [l.sha, l.text])).toEqual([
      [first, 'one'],
      [second, 'TWO'],
      [second, 'three']
    ])
    expect(lines[0]).toMatchObject({ author: 'Test User' })
    expect(lines[0]!.date).toBeGreaterThan(Date.now() - 60_000)
    expect((await getBlame(fx.work, first, 'a.txt', fx.env)).map((l) => l.text)).toEqual(['one', 'two'])
    await expect(getBlame(fx.work, first, 'missing.txt', fx.env)).rejects.toThrow()
  })

  it('filters by message/author (case-insensitive, literal) and by one file across renames', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n', 'Fix (parser)')
    fx.git(['mv', 'a.txt', 'b.txt'])
    fx.commitFile('c.txt', 'c\n', 'rename a')
    fx.commitFile('b.txt', 'b\n', 'edit b')
    const f = (filter: Parameters<typeof getLog>[4], skip = 0) => getLog(fx.work, skip, fx.env, undefined, filter).then((l) => l.map((c) => c.summary))
    expect(await f({ text: 'fix (PARSER' })).toEqual(['Fix (parser)'])
    expect(await f({ text: '--all' })).toEqual([])
    expect(await f({ author: 'test user' })).toHaveLength(4)
    expect(await f({ author: 'nobody' })).toEqual([])
    expect(await f({ text: 'edit', author: 'nobody' })).toEqual([])
    expect(await f({ path: 'b.txt' })).toEqual(['edit b', 'rename a', 'Fix (parser)'])
    expect(await f({ path: 'b.txt' }, 2)).toEqual(['Fix (parser)'])
    expect(await f({ path: 'b.txt', text: 'rename' })).toEqual(['rename a'])
    expect((await getLog(fx.work, 0, fx.env, undefined, { path: 'b.txt' }))[0]!.unpushed).toBe(true)
  })

  it('advanced search: qualifiers become git args; trailers match their own line only', async () => {
    fx = createRepoFixture()
    const commit = (file: string, message: string, env: Record<string, string>, date: string) => {
      mkdirSync(dirname(join(fx.work, file)), { recursive: true })
      writeFileSync(join(fx.work, file), file)
      fx.git(['add', file])
      execFileSync('git', ['commit', '-q', '-m', message], { cwd: fx.work, env: { ...fx.env, ...env, GIT_COMMITTER_DATE: date }, stdio: 'pipe' })
      return fx.git(['rev-parse', 'HEAD'])
    }
    commit('a.txt', 'Fix crash\n\nChange-Id: Iabc123\nReviewed-by: Elena Lanets <elena@example.com>\nReviewed-on: https://review.example.com/c/p/+/1234\nBug: 42', {}, '2024-01-10T12:00:00Z')
    const robot = commit('src/b.txt', 'Mention Reviewed-by: Elena in the body (a+b)\n\nTested-by: CI Bot', { GIT_AUTHOR_NAME: 'Robot Bot', GIT_COMMITTER_NAME: 'Robot Bot' }, '2024-03-10T12:00:00Z')
    commit('c.txt', 'Plain change\n\nSigned-off-by: Test User <test@example.com>\nChange-Id: Ixyz789', { GIT_COMMITTER_NAME: 'Robot Bot' }, '2024-05-10T12:00:00Z')
    const f = (q: string) => {
      const { query, errors } = parseHistoryQuery(q)
      expect(errors).toEqual([])
      return getLog(fx.work, 0, fx.env, undefined, query).then((l) => l.map((c) => c.summary))
    }

    expect(logFilterArgs(parseHistoryQuery('fix reviewer:"Elena L." author:-x').query)).toEqual([
      '--extended-regexp',
      '--regexp-ignore-case',
      '--all-match',
      '--grep=fix',
      '--grep=^Reviewed-by:[[:space:]]*.*Elena L\\.',
      '--author=-x'
    ])
    expect(logFilterArgs(parseHistoryQuery('a+b author:x before:2024-01-01').query)).toEqual(['--fixed-strings', '--regexp-ignore-case', '--grep=a+b', '--author=x', '--before=2024-01-01'])
    expect(logFilterArgs(parseHistoryQuery('after:"2 weeks ago"').query)).toEqual(['--after=2 weeks ago'])

    expect(await f('change:Iabc')).toEqual(['Fix crash'])
    expect(await f('change:abc')).toEqual([]) // prefix, not substring
    expect(await f('CHANGE:i')).toEqual(['Plain change', 'Fix crash'])
    // the body line "Mention Reviewed-by: ..." does not start a line with the trailer key
    expect(await f('reviewer:elena')).toEqual(['Fix crash'])
    expect(await f('reviewed-on:1234')).toEqual(['Fix crash'])
    expect(await f('reviewed-on:https://review.example.com/c/p/+/1234')).toEqual(['Fix crash'])
    expect(await f('tested-by:"ci bot"')).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f('signed-off-by:test')).toEqual(['Plain change'])
    expect(await f('trailer:Bug=42')).toEqual(['Fix crash'])
    expect(await f('trailer:Bug=4.')).toEqual([]) // regex metacharacters are literal
    expect(await f('(a+b)')).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f('crash change:Iabc reviewer:elena')).toEqual(['Fix crash'])
    expect(await f('crash change:Ixyz')).toEqual([])
    expect(await f('committer:robot')).toEqual(['Plain change', 'Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f('author:robot')).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f('author:"test user" committer:robot')).toEqual(['Plain change'])
    expect(await f('path:src')).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f('after:2024-02-01 before:2024-04-01')).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f(`sha:${robot.slice(0, 8)}`)).toEqual(['Mention Reviewed-by: Elena in the body (a+b)'])
    expect(await f(`sha:${robot.slice(0, 8)} author:nobody`)).toEqual([])
    expect(await f('sha:0000000')).toEqual([])
    expect(await getLog(fx.work, 100, fx.env, undefined, { sha: robot })).toEqual([])
  })

  it('empty repo has no commits', async () => {
    fx = createRepoFixture()
    fx.git(['checkout', '-q', '--orphan', 'fresh'])
    expect(await getLog(fx.work, 0, fx.env)).toEqual([])
  })
})
