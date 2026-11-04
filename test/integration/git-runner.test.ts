import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitInfo } from '../../src/main/git/info'
import { endOfOptions, git, GitError, gitBusy, killAllGit } from '../../src/main/git/runner'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('git runner against real git', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('runs commands with arg arrays and isolated env', async () => {
    fx = createRepoFixture()
    const { stdout } = await git(['log', '-1', '--format=%H', ...endOfOptions('HEAD')], { cwd: fx.work, env: fx.env })
    expect(stdout.trim()).toBe(fx.git(['rev-parse', 'HEAD']))
  })

  it('feeds stdin (commit -F -)', async () => {
    fx = createRepoFixture()
    await git(['commit', '--allow-empty', '-q', '-F', '-'], { cwd: fx.work, env: fx.env, stdin: 'summary\n\n-description; $(touch x)\n' })
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('summary\n\n-description; $(touch x)')
  })

  it('maps failures to GitError kinds', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mendel-norepo-'))
    try {
      const err = await git(['status'], { cwd: dir, env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) } }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(GitError)
      expect((err as GitError).kind).toBe('NotARepository')
      expect((err as GitError).exitCode).toBe(128)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('redacts credentials from errors', async () => {
    fx = createRepoFixture()
    const err = (await git(['ls-remote', 'https://bob:hunter2@127.0.0.1:9/x.git'], { cwd: fx.work, env: fx.env }).catch((e: unknown) => e)) as GitError
    expect(err.kind).toBe('RemoteUnreachable')
    expect(`${err.message} ${err.stderr} ${err.args.join(' ')}`).not.toContain('hunter2')
  })

  it('decodes multibyte output split across pipe chunks', async () => {
    fx = createRepoFixture()
    const text = 'şğü🙂'.repeat(40_000) // ~440 KB of 2- and 4-byte UTF-8, many 64 KB chunk boundaries
    fx.commitFile('big.txt', text + '\n')
    const { stdout } = await git(['show', 'HEAD:big.txt'], { cwd: fx.work, env: fx.env })
    expect(stdout).not.toContain('\ufffd')
    expect(stdout).toBe(text + '\n')
  })

  it('kills git on abort', async () => {
    fx = createRepoFixture()
    const ac = new AbortController()
    const started = Date.now()
    // test-only shell alias to get a slow git process
    const run = git(['-c', 'alias.slow=!sleep 10', 'slow'], { cwd: fx.work, env: fx.env, signal: ac.signal })
    setTimeout(() => ac.abort(), 100)
    await expect(run).rejects.toMatchObject({ kind: 'Cancelled' })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('a spawn failure (missing cwd) does not leave gitBusy stuck', async () => {
    await expect(git(['status'], { cwd: path.join(tmpdir(), 'mendel-no-such-dir-' + Date.now()) })).rejects.toBeInstanceOf(GitError)
    expect(gitBusy()).toBe(false)
  })

  it('killAllGit ends running git children (app quit)', async () => {
    fx = createRepoFixture()
    const started = Date.now()
    const run = git(['-c', 'alias.slow=!sleep 10', 'slow'], { cwd: fx.work, env: fx.env }).catch((e: unknown) => e)
    setTimeout(killAllGit, 100)
    expect(await run).toBeInstanceOf(GitError)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('reports version info', async () => {
    const info = await gitInfo()
    expect(info).toMatchObject({ found: true, supported: true })
  })
})
