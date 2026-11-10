import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const userData = mkdtempSync(path.join(tmpdir(), 'mendel-wt-userdata-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../../src/main/log', () => ({ default: { warn: () => {} } }))
const { repoTopLevel } = await import('../../src/main/git/repo')
const { addWorktree, listWorktrees, parseWorktrees, pruneWorktrees, removeWorktree } = await import('../../src/main/git/worktree')
const { forgetPath, linkedWorktree, listRepos, rememberRepo } = await import('../../src/main/repos')

describe('worktrees', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const wt = (name: string) => path.join(fx.dir, name)

  it('parses porcelain -z: main, branch, detached, locked reason, prunable; bare main skipped', () => {
    const out = ['worktree /r', 'HEAD ' + 'a'.repeat(40), 'branch refs/heads/main', '', 'worktree /r-x', 'HEAD ' + 'b'.repeat(40), 'detached', 'locked on usb', 'prunable gitdir file points to non-existent location', ''].join('\0') + '\0'
    expect(parseWorktrees(out, '/r-x')).toEqual([
      { path: '/r', branch: 'main', head: 'a'.repeat(40), main: true, current: false, locked: null, prunable: false },
      { path: '/r-x', branch: null, head: 'b'.repeat(40), main: false, current: true, locked: 'on usb', prunable: true }
    ])
    expect(parseWorktrees(['worktree /b.git', 'bare', '', 'worktree /w', 'HEAD ' + 'c'.repeat(40), 'branch refs/heads/x', 'locked', ''].join('\0') + '\0', '/w')).toEqual([
      { path: '/w', branch: 'x', head: 'c'.repeat(40), main: false, current: true, locked: '', prunable: false }
    ])
  })

  it('adds from a new branch, an existing local branch and a remote branch; lists them', async () => {
    fx = createRepoFixture()
    fx.git(['branch', 'local-one'])
    fx.git(['push', '-q', 'origin', 'main:remote-one'])
    fx.git(['fetch', '-q'])
    await addWorktree(fx.work, wt('w-new'), { branch: 'feat/new', create: true, base: 'main' }, fx.env)
    await addWorktree(fx.work, wt('w-local'), { branch: 'local-one', create: false }, fx.env)
    await addWorktree(fx.work, wt('w-remote'), { branch: 'origin/remote-one', create: false }, fx.env)
    await expect(addWorktree(fx.work, wt('w-bad'), { branch: '-x', create: true }, fx.env)).rejects.toThrow('Invalid branch name')
    await expect(addWorktree(fx.work, wt('w-bad'), { branch: 'nope', create: false }, fx.env)).rejects.toThrow('Unknown branch')
    await expect(addWorktree(fx.work, wt('w-new'), { branch: 'again', create: true }, fx.env)).rejects.toThrow(/already exists/)

    const list = await listWorktrees(fx.work, fx.env)
    // Main first, then git's order (by admin dir name).
    expect(list.map((w) => [path.resolve(w.path), w.branch, w.main, w.current]).sort((a, b) => Number(b[2]) - Number(a[2]) || String(a[1]).localeCompare(String(b[1])))).toEqual([
      [fx.work, 'main', true, true],
      [wt('w-new'), 'feat/new', false, false],
      [wt('w-local'), 'local-one', false, false],
      [wt('w-remote'), 'remote-one', false, false]
    ])
    expect(fx.git(['rev-parse', '--abbrev-ref', 'remote-one@{upstream}'])).toBe('origin/remote-one')
    expect((await listWorktrees(wt('w-new'), fx.env)).find((w) => w.current)?.branch).toBe('feat/new')
  })

  it('a linked worktree opens as its own repo, labelled with its main repo and branch, nested under it', async () => {
    fx = createRepoFixture()
    await addWorktree(fx.work, wt('w'), { branch: 'feat', create: true }, fx.env)
    expect(await repoTopLevel(path.join(wt('w')), fx.env)).toBe(wt('w'))
    expect(linkedWorktree(wt('w'))).toEqual({ main: fx.work, branch: 'feat' })
    expect(linkedWorktree(fx.work)).toBeUndefined()
    fx.git(['switch', '-q', '--detach'], wt('w'))
    expect(linkedWorktree(wt('w'))).toEqual({ main: fx.work, branch: null })

    const other = rememberRepo(fx.remote)
    const main = rememberRepo(fx.work)
    const linked = rememberRepo(wt('w')) // most recent, but listed right after its main repo
    expect(listRepos().repos.map((r) => [r.id, r.name])).toEqual([
      [main.id, 'work'],
      [linked.id, 'work'],
      [other.id, 'remote.git']
    ])
    forgetPath(wt('w'))
    expect(listRepos().repos.map((r) => r.id)).toEqual([main.id, other.id])
  })

  it('removes: main, current and unknown paths refused; dirty needs force; prune drops a deleted folder', async () => {
    fx = createRepoFixture()
    await addWorktree(fx.work, wt('w'), { branch: 'feat', create: true }, fx.env)
    await addWorktree(fx.work, wt('gone'), { branch: 'gone', create: true }, fx.env)
    const all = await listWorktrees(fx.work, fx.env)
    const main = all.find((x) => x.main)
    const w = all.find((x) => x.branch === 'feat')
    await expect(removeWorktree(fx.work, main!.path, false, fx.env)).rejects.toThrow('main worktree')
    await expect(removeWorktree(wt('w'), w!.path, false, fx.env)).rejects.toThrow('is open')
    await expect(removeWorktree(fx.work, path.join(fx.dir, 'elsewhere'), false, fx.env)).rejects.toThrow('Unknown worktree')

    writeFileSync(path.join(wt('w'), 'dirty.txt'), 'x')
    expect(await removeWorktree(fx.work, w!.path, false, fx.env)).toBe('dirty')
    expect(existsSync(wt('w'))).toBe(true)
    expect(await removeWorktree(fx.work, w!.path, true, fx.env)).toBe('ok')
    expect(existsSync(wt('w'))).toBe(false)
    expect(fx.git(['branch', '--list', 'feat'])).toContain('feat') // branch kept

    rmSync(wt('gone'), { recursive: true, force: true })
    expect((await listWorktrees(fx.work, fx.env)).find((x) => x.branch === 'gone')?.prunable).toBe(true)
    await pruneWorktrees(fx.work, fx.env)
    expect((await listWorktrees(fx.work, fx.env)).map((x) => x.branch)).toEqual(['main'])
  })
})
