import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stagePaths } from '../../src/main/git/changes'
import { abortOp, continueOp, opInProgress } from '../../src/main/git/conflict'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('conflicts', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  /** main and `other` both change README.md. */
  const diverge = () => {
    fx = createRepoFixture()
    fx.git(['switch', '-q', '-c', 'other'])
    fx.commitFile('README.md', 'theirs\n')
    fx.git(['switch', '-q', 'main'])
    return fx.commitFile('README.md', 'ours\n')
  }
  const resolve = async () => {
    writeFileSync(path.join(fx.work, 'README.md'), 'resolved\n')
    await stagePaths(fx.work, ['README.md'], fx.env)
  }

  it('merge: mark resolved + continue completes; nothing in progress after', async () => {
    diverge()
    expect(() => fx.git(['merge', 'other'])).toThrow()
    expect(await opInProgress(fx.work, fx.env)).toBe('merge')
    await expect(continueOp(fx.work, fx.env)).rejects.toThrow('resolved first')
    await resolve()
    expect(await continueOp(fx.work, fx.env)).toBe('ok')
    expect(await opInProgress(fx.work, fx.env)).toBeNull()
    expect(fx.git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ')).toHaveLength(3)
  })

  it('rebase: continue completes; abort restores the pre-op HEAD', async () => {
    const before = diverge()
    expect(() => fx.git(['rebase', 'other'])).toThrow()
    expect(await opInProgress(fx.work, fx.env)).toBe('rebase')
    await abortOp(fx.work, fx.env)
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(before)
    expect(await opInProgress(fx.work, fx.env)).toBeNull()

    expect(() => fx.git(['rebase', 'other'])).toThrow()
    await resolve()
    expect(await continueOp(fx.work, fx.env)).toBe('ok')
    expect(fx.git(['log', '--format=%s', '-2'])).toBe('add README.md\nadd README.md')
    expect(fx.git(['rev-parse', 'HEAD~1'])).toBe(fx.git(['rev-parse', 'other']))
  })
})
