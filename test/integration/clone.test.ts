import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneRepo } from '../../src/main/git/clone'
import { startMockServer } from '../fixtures/mock-server'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('cloneRepo', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('clones from a bare remote', async () => {
    fx = createRepoFixture()
    const dest = path.join(fx.dir, 'clones/copy')
    await cloneRepo(fx.remote, dest, { env: fx.env })
    expect(fx.git(['log', '-1', '--format=%s'], dest)).toBe('initial commit')
  })

  it('refuses a non-empty destination and leaves it untouched', async () => {
    fx = createRepoFixture()
    const dest = path.join(fx.dir, 'busy')
    mkdirSync(dest)
    writeFileSync(path.join(dest, 'keep.txt'), 'x')
    await expect(cloneRepo(fx.remote, dest, { env: fx.env })).rejects.toThrow(/not empty/)
    expect(readdirSync(dest)).toEqual(['keep.txt'])
  })

  it('cancel mid-clone leaves no partial folder', async () => {
    fx = createRepoFixture()
    const hang = await startMockServer({ 'GET /repo.git/info/refs': () => new Promise(() => {}) })
    try {
      const dest = path.join(fx.dir, 'cancelled')
      const ac = new AbortController()
      const run = cloneRepo(`${hang.url}/repo.git`, dest, { env: fx.env, signal: ac.signal })
      await expect.poll(() => hang.requests.length).toBeGreaterThan(0)
      ac.abort()
      await expect(run).rejects.toMatchObject({ kind: 'Cancelled' })
      expect(existsSync(dest)).toBe(false)
    } finally {
      await hang.close()
    }
  })

  it('failed clone removes the folder it created', async () => {
    fx = createRepoFixture()
    const dest = path.join(fx.dir, 'failed')
    await expect(cloneRepo(path.join(fx.dir, 'missing.git'), dest, { env: fx.env })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
  })
})
