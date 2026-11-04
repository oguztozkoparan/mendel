import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultOpener, validCustomTool } from '../../src/main/external'

describe('defaultOpener ("System default" editor never executes repo files)', () => {
  it('folders open with the OS, except macOS bundles', () => {
    for (const p of ['darwin', 'win32', 'linux'] as const) expect(defaultOpener(p, '/r/src', true)).toBe('openPath')
    expect(defaultOpener('darwin', '/r/Evil.app', true)).toBe('reveal')
  })
  it('macOS files always go to the text editor', () => {
    for (const f of ['/r/a.command', '/r/a.fileloc', '/r/bin', '/r/a.txt']) expect(defaultOpener('darwin', f, false)).toBe('text')
  })
  it('Windows/Linux open only allowlisted extensions, else reveal', () => {
    for (const p of ['win32', 'linux'] as const) {
      for (const f of ['/r/README.md', '/r/a.TS', '/r/logo.png']) expect(defaultOpener(p, f, false)).toBe('openPath')
      for (const f of ['/r/a.bat', '/r/a.cmd', '/r/a.lnk', '/r/a.url', '/r/a.hta', '/r/a.js', '/r/a.vbs', '/r/a.exe', '/r/a.ps1', '/r/a.desktop', '/r/a.sh', '/r/a.html', '/r/a.svg', '/r/bin', '/r/a.txt.']) {
        expect(defaultOpener(p, f, false)).toBe('reveal')
      }
    }
  })
})

describe.skipIf(process.platform === 'win32')('validCustomTool', () => {
  it('Windows accepts only .exe; elsewhere any executable file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gitdock-tool-'))
    try {
      const [exe, cmd] = ['tool.EXE', 'tool.cmd'].map((n) => path.join(dir, n))
      for (const f of [exe, cmd]) writeFileSync(f, ''), chmodSync(f, 0o755)
      expect(validCustomTool(exe, 'win32')).toBe(true)
      expect(validCustomTool(cmd, 'win32')).toBe(false)
      expect(validCustomTool(cmd, 'linux')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
