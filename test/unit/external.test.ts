import { describe, expect, it } from 'vitest'
import { defaultOpener } from '../../src/main/external'

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
