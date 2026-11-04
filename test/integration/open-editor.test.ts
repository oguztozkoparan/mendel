import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ openPath: vi.fn(async () => ''), showItemInFolder: vi.fn(), spawn: vi.fn() }))
vi.mock('electron', () => ({ shell: { openPath: m.openPath, showItemInFolder: m.showItemInFolder }, app: { getPath: () => tmpdir() } }))
vi.mock('node:child_process', async (orig) => ({ ...(await orig<typeof import('node:child_process')>()), spawn: m.spawn }))
vi.mock('../../src/main/settings', () => ({ getSettings: () => ({ editor: 'system', editorPath: '' }) }))
const { openInEditor } = await import('../../src/main/external')

describe('openInEditor with "System default"', () => {
  const dirs: string[] = []
  afterEach(() => (dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })), vi.clearAllMocks()))
  const tmp = () => (dirs.push(mkdtempSync(path.join(tmpdir(), 'mendel-open-'))), realpathSync(dirs.at(-1)!))

  it('never hands an executable repo file to the OS association', async () => {
    m.spawn.mockImplementation(() => {
      const c = Object.assign(new EventEmitter(), { unref: () => {} })
      queueMicrotask(() => c.emit('spawn'))
      return c
    })
    const root = tmp()
    const file = path.join(root, 'evil.command')
    writeFileSync(file, '#!/bin/sh\n')
    const r = openInEditor(root, file)
    if (process.platform === 'darwin') {
      await r
      expect(m.spawn).toHaveBeenCalledWith('/usr/bin/open', ['-t', file], expect.objectContaining({ shell: false }))
    } else {
      await expect(r).rejects.toThrow('Choose an editor in Settings')
      expect(m.showItemInFolder).toHaveBeenCalledWith(file)
    }
    expect(m.openPath).not.toHaveBeenCalled()
  })

  it('rejects a symlink that leaves the repo; a folder opens with the OS', async () => {
    const [root, outside] = [tmp(), tmp()]
    mkdirSync(path.join(root, 'src'))
    await openInEditor(root, path.join(root, 'src'))
    expect(m.openPath).toHaveBeenCalledWith(path.join(root, 'src'))
    writeFileSync(path.join(outside, 'x.txt'), 'x')
    try {
      symlinkSync(path.join(outside, 'x.txt'), path.join(root, 'link.txt'))
    } catch {
      return // shortcut: Windows without symlink privilege skips this check
    }
    await expect(openInEditor(root, path.join(root, 'link.txt'))).rejects.toThrow('Invalid path')
  })
})
