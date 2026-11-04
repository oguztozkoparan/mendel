import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'

vi.mock('../../src/main/log', () => ({ default: { warn: () => {} } }))
vi.mock('node:fs', async (orig) => ({
  ...(await orig<typeof import('node:fs')>()),
  watch: () => {
    throw Object.assign(new Error('ENOSPC: System limit for number of file watchers reached'), { code: 'ENOSPC' })
  }
}))
const { watchRepo } = await import('../../src/main/watch')

it('watcher failure (inotify limit) turns auto-refresh off once instead of failing status', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mendel-watchoff-'))
  try {
    const off = vi.fn()
    expect(() => watchRepo(dir, () => {}, off)).not.toThrow()
    await vi.waitFor(() => expect(off).toHaveBeenCalledTimes(1))
    watchRepo(dir, () => {}, off) // next status poll: no retry, no second notice
    await new Promise((r) => setTimeout(r, 50))
    expect(off).toHaveBeenCalledTimes(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
