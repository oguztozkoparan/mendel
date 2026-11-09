import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cliPath, cliScript } from '../../src/main/cli'

describe('cliPath', () => {
  const w = realpathSync(mkdtempSync(path.join(tmpdir(), 'mendel-clipath-')))
  mkdirSync(path.join(w, 'sub'))
  afterAll(() => rmSync(w, { recursive: true, force: true }))

  it('resolves an existing last argument against cwd, skipping the exe (and main script when unpackaged)', () => {
    expect(cliPath(['/Mendel', '.'], w, false)).toBe(w)
    expect(cliPath(['electron', 'out/main/index.js', 'sub'], w, true)).toBe(path.join(w, 'sub'))
    expect(cliPath(['electron', '--inspect=0', 'out/main/index.js', '--remote-debugging-port=0', 'sub'], w, true)).toBe(path.join(w, 'sub'))
  })
  it('takes the arg after `--` as given, existing or not', () => {
    expect(cliPath(['/Mendel', '--', '/abs/r'], w, false)).toBe(path.resolve('/abs/r'))
    expect(cliPath(['electron', 'out/main/index.js', '--', 'missing'], w, true)).toBe(path.join(w, 'missing'))
    expect(cliPath(['/Mendel', '--', '-dash'], w, false)).toBe(path.join(w, '-dash'))
    expect(cliPath(['/Mendel', '--'], w, false)).toBeNull()
  })
  it('null without a path, for switches only, switch values, missing paths and NUL bytes', () => {
    expect(cliPath(['/Mendel'], w, false)).toBeNull()
    expect(cliPath(['electron', 'out/main/index.js'], w, true)).toBeNull()
    // Chromium puts its switches before the main script in second-instance argv.
    expect(cliPath(['electron', '--allow-file-access-from-files', 'out/main/index.js'], w, true)).toBeNull()
    expect(cliPath(['/Mendel', '-psn_0_123', '--allow-file-access'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', 'sub', '--flag'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', '-AppleLanguages', '(en)'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', '--user-data-dir', 'sub'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', 'missing'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', 'a\0b'], w, false)).toBeNull()
    expect(cliPath(['/Mendel', '--', 'a\0b'], w, false)).toBeNull()
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
      const run = async (arg: string, env: NodeJS.ProcessEnv = {}) => {
        rmSync(out, { force: true })
        execFileSync('sh', [script, arg], { cwd: tmp, env: { ...process.env, OUT: out, ...env } })
        for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20))
        await new Promise((r) => setTimeout(r, 50))
        return readFileSync(out, 'utf8').split('\n')
      }
      expect(await run('repo dir')).toEqual(['a b', '--', path.join(tmp, 'repo dir'), ''])
      // A CDPATH hit makes cd print the dir; it must not end up in the captured path.
      mkdirSync(path.join(tmp, 'cdp', 'x'), { recursive: true })
      expect(await run('x', { CDPATH: path.join(tmp, 'cdp') })).toEqual(['a b', '--', path.join(tmp, 'cdp', 'x'), ''])
      expect(() => execFileSync('sh', [script, 'missing'], { cwd: tmp, stdio: 'ignore' })).toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
