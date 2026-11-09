import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliPath, cliScript } from '../../src/main/cli'

describe('cliPath', () => {
  it('resolves the last non-switch argument against cwd, skipping the exe (and main script when unpackaged)', () => {
    expect(cliPath(['/Mendel', '.'], '/w/repo', false)).toBe(path.resolve('/w/repo'))
    expect(cliPath(['electron', 'out/main/index.js', '--inspect=0', 'sub'], '/w', true)).toBe(path.resolve('/w/sub'))
    expect(cliPath(['/Mendel', '--', '/abs/r'], '/w', false)).toBe(path.resolve('/abs/r'))
  })
  it('null without a path, for switches only, and for NUL bytes', () => {
    expect(cliPath(['/Mendel'], '/w', false)).toBeNull()
    expect(cliPath(['electron', 'out/main/index.js'], '/w', true)).toBeNull()
    expect(cliPath(['/Mendel', '-psn_0_123', '--allow-file-access'], '/w', false)).toBeNull()
    expect(cliPath(['/Mendel', 'a\0b'], '/w', false)).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('cliScript', () => {
  it('passes the absolute dir to the command; quotes survive', async () => {
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "mendel cli '")))
    try {
      const out = path.join(tmp, 'args')
      const rec = path.join(tmp, "rec 'x'.sh")
      writeFileSync(rec, `#!/bin/sh\nprintf '%s\\n' "$@" > "$OUT"\n`)
      chmodSync(rec, 0o755)
      const script = path.join(tmp, 'mendel')
      writeFileSync(script, cliScript([rec, 'a b']))
      mkdirSync(path.join(tmp, 'repo dir'))
      execFileSync('sh', [script, 'repo dir'], { cwd: tmp, env: { ...process.env, OUT: out } })
      for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 50))
      expect(readFileSync(out, 'utf8').split('\n')).toEqual(['a b', '--', path.join(tmp, 'repo dir'), ''])
      expect(() => execFileSync('sh', [script, 'missing'], { cwd: tmp, stdio: 'ignore' })).toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
