import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { opInProgress } from '../../src/main/git/conflict'
import { hasLocalChanges, pull, rebaseOntoUpstream } from '../../src/main/git/sync'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('rebase onto upstream', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const remoteCommit = (name: string, content: string) => {
    const other = path.join(fx.dir, 'other')
    execFileSync('git', ['clone', '-q', fx.remote, other], { env: fx.env })
    writeFileSync(path.join(other, name), content)
    for (const a of [['add', name], ['commit', '-qm', `remote ${name}`], ['push', '-q']]) execFileSync('git', a, { cwd: other, env: fx.env })
  }

  it('clean case: fetches and replays local commits on top', async () => {
    fx = createRepoFixture()
    remoteCommit('r.txt', 'r\n')
    fx.commitFile('a.txt', 'a\n')
    expect(await rebaseOntoUpstream(fx.work, false, { env: fx.env })).toBe('ok')
    expect(fx.git(['log', '--format=%s', '-3'])).toBe('add a.txt\nremote r.txt\ninitial commit')
  })

  it('dirty tree with autostash keeps the local changes', async () => {
    fx = createRepoFixture()
    remoteCommit('r.txt', 'r\n')
    fx.commitFile('a.txt', 'a\n')
    writeFileSync(path.join(fx.work, 'a.txt'), 'dirty\n')
    expect(await hasLocalChanges(fx.work, fx.env)).toBe(true)
    expect(await rebaseOntoUpstream(fx.work, true, { env: fx.env })).toBe('ok')
    expect(readFileSync(path.join(fx.work, 'a.txt'), 'utf8')).toBe('dirty\n')
    expect(fx.git(['rev-parse', 'HEAD~1'])).toBe(fx.git(['rev-parse', 'origin/main']))
  })

  it('autostash whose re-apply conflicts is a conflict (git exits 0), stash kept', async () => {
    fx = createRepoFixture()
    remoteCommit('README.md', 'theirs\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'mine\n')
    expect(await rebaseOntoUpstream(fx.work, true, { env: fx.env })).toBe('conflict')
    expect(await opInProgress(fx.work, fx.env)).toBeNull()
    expect(fx.git(['ls-files', '--unmerged'])).toContain('README.md')
    expect(fx.git(['stash', 'list', '--format=%gs'])).toContain('autostash')
  })

  it('pull --rebase --autostash: same conflict detection', async () => {
    fx = createRepoFixture()
    remoteCommit('README.md', 'theirs\n')
    writeFileSync(path.join(fx.work, 'README.md'), 'mine\n')
    expect(await pull(fx.work, true, { env: fx.env }, true)).toBe('conflict')
    expect(fx.git(['stash', 'list', '--format=%gs'])).toContain('autostash')
  })

  it('conflict case stops with a rebase in progress', async () => {
    fx = createRepoFixture()
    remoteCommit('README.md', 'theirs\n')
    fx.commitFile('README.md', 'ours\n')
    expect(await rebaseOntoUpstream(fx.work, false, { env: fx.env })).toBe('conflict')
    expect(await opInProgress(fx.work, fx.env)).toBe('rebase')
  })
})
