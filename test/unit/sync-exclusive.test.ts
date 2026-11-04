import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/repos', () => ({}))
vi.mock('../../src/main/settings', () => ({}))
vi.mock('../../src/main/ipc/branch', () => ({}))
vi.mock('../../src/main/ipc/provider', () => ({}))
const { exclusive } = await import('../../src/main/ipc/sync')

const untilAborted = (signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))

describe('exclusive sync ops', () => {
  it('a manual op aborts a running auto-fetch and then runs', async () => {
    const auto = exclusive(untilAborted, true)
    await expect(exclusive(async () => 'manual')).resolves.toBe('manual')
    await expect(auto).rejects.toThrow('aborted')
  })

  it('a second manual op is refused while one runs; auto-fetch does not abort it', async () => {
    let finish!: () => void
    const first = exclusive(() => new Promise<void>((r) => (finish = r)))
    await expect(exclusive(async () => 1)).rejects.toThrow('Another sync operation is running')
    await expect(exclusive(async () => 1, true)).rejects.toThrow('Another sync operation is running')
    finish()
    await first
    await expect(exclusive(async () => 2)).resolves.toBe(2)
  })
})
