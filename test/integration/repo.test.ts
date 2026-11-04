import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dubiousDir, repoTopLevel, trustDirectory } from '../../src/main/git/repo'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('repoTopLevel', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('dubious ownership: trusting exactly the reported folder lets it open (S16)', async () => {
    fx = createRepoFixture()
    const env = { ...fx.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' } // git's own knob for the ownership check
    mkdirSync(path.join(fx.work, 'sub'))
    const err = await repoTopLevel(path.join(fx.work, 'sub'), env).catch((e: unknown) => e)
    expect(err).toMatchObject({ kind: 'DubiousOwnership' })
    const dir = dubiousDir(err)!
    expect(path.resolve(dir)).toBe(fx.work) // git prints `C:/…` on Windows
    await expect(trustDirectory('*', env)).rejects.toThrow('Invalid folder')
    await trustDirectory(dir, env)
    expect(fx.git(['config', '--global', '--get-all', 'safe.directory'])).toBe(dir)
    expect(await repoTopLevel(path.join(fx.work, 'sub'), env)).toBe(fx.work)
  })

  it('resolves a subfolder to the work tree root', async () => {
    fx = createRepoFixture()
    mkdirSync(path.join(fx.work, 'a/b'), { recursive: true })
    expect(await repoTopLevel(path.join(fx.work, 'a/b'), fx.env)).toBe(fx.work)
  })

  it('rejects non-repos and bare repos as NotARepository', async () => {
    fx = createRepoFixture()
    const dir = mkdtempSync(path.join(tmpdir(), 'mendel-norepo-'))
    try {
      await expect(repoTopLevel(dir, { ...fx.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) })).rejects.toMatchObject({ kind: 'NotARepository', message: 'Not a git repository' })
      await expect(repoTopLevel(fx.remote, fx.env)).rejects.toMatchObject({ kind: 'NotARepository' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
