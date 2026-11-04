import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/log', () => ({ default: { warn: () => {} } }))
const { watchRepo } = await import('../../src/main/watch')

describe('watchRepo', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('debounces, but still fires during constant churn (max wait)', async () => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'gitdock-watch-')))
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
})
