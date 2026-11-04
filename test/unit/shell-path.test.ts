import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loginShellPath, mergePath } from '../../src/main/shell-path'

describe('login shell PATH', () => {
  const d = path.delimiter
  it('puts login-shell dirs first and keeps current ones it lacks, deduped', () => {
    expect(mergePath(['/usr/bin', '/bin'].join(d), ['/opt/homebrew/bin', '/usr/bin', '', '/opt/homebrew/bin'].join(d))).toBe(['/opt/homebrew/bin', '/usr/bin', '/bin'].join(d))
    expect(mergePath('/usr/bin', null)).toBe('/usr/bin')
    expect(mergePath(undefined, null)).toBe('')
  })

  it.skipIf(process.platform === 'win32')('reads PATH from a login shell despite rc-file noise', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'mendel-shell-'))
    try {
      writeFileSync(path.join(home, '.profile'), 'echo welcome banner\nexport PATH="/from/profile:$PATH"\n')
      const got = await loginShellPath('/bin/sh', { HOME: home, PATH: '/usr/bin:/bin', ENV: '' })
      expect(got?.split(':')[0]).toBe('/from/profile')
      expect(await loginShellPath('/nonexistent/shell', { PATH: '/usr/bin' })).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
