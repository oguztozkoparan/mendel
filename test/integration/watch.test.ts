import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRepoFixture } from '../fixtures/repo'

vi.mock('../../src/main/log', () => ({ default: { warn: () => {} } }))
const { linuxWatchDirs, watchRepo } = await import('../../src/main/watch')

describe('watchRepo', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('debounces, but still fires during constant churn (max wait)', async () => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mendel-watch-')))
    const calls: number[] = []
    watchRepo(dir, () => calls.push(Date.now()))
    const start = Date.now()
    while (Date.now() - start < 2500) {
      writeFileSync(path.join(dir, 'churn.txt'), String(Date.now()))
      await new Promise((r) => setTimeout(r, 50)) // faster than the 200 ms quiet period
    }
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]! - start).toBeLessThan(2000)
  })

  it('Linux dir list skips node_modules and git-ignored top-level dirs', async () => {
    const fx = createRepoFixture()
    dir = fx.dir
    for (const d of ['src', 'build', 'node_modules', 'venv']) mkdirSync(path.join(fx.work, d))
    writeFileSync(path.join(fx.work, '.gitignore'), 'build/\n/venv\n')
    expect((await linuxWatchDirs(fx.work, fx.env)).sort()).toEqual(['.git', 'src'])
  })
})
