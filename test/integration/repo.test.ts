import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { repoTopLevel } from '../../src/main/git/repo'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('repoTopLevel', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('resolves a subfolder to the work tree root', async () => {
    fx = createRepoFixture()
    mkdirSync(path.join(fx.work, 'a/b'), { recursive: true })
    expect(await repoTopLevel(path.join(fx.work, 'a/b'), fx.env)).toBe(fx.work)
  })

  it('rejects non-repos and bare repos as NotARepository', async () => {
    fx = createRepoFixture()
    const dir = mkdtempSync(path.join(tmpdir(), 'gitdock-norepo-'))
    try {
      await expect(repoTopLevel(dir, { ...fx.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) })).rejects.toMatchObject({ kind: 'NotARepository', message: 'Not a git repository' })
      await expect(repoTopLevel(fx.remote, fx.env)).rejects.toMatchObject({ kind: 'NotARepository' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
