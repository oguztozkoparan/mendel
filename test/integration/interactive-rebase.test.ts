import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { continueOp, opInProgress } from '../../src/main/git/conflict'
import { interactiveRebase } from '../../src/main/git/rebase'
import type { RebaseStep } from '../../src/shared/ipc'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('interactive rebase of unpushed commits', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  /** Three unpushed commits a, b, c (oldest first). */
  const setup = () => {
    fx = createRepoFixture()
    return ['a', 'b', 'c'].map((n) => fx.commitFile(`${n}.txt`, `${n}\n`))
  }
  const run = (steps: RebaseStep[], autostash = false) => interactiveRebase(fx.work, steps, autostash, fx.env)
  const subjects = () => fx.git(['log', '--format=%s', 'origin/main..HEAD'])
  const pick = (sha: string): RebaseStep => ({ sha, action: 'pick' })

  it('reorders', async () => {
    const [a, b, c] = setup()
    expect(await run([pick(c!), pick(a!), pick(b!)])).toBe('ok')
    expect(subjects()).toBe('add b.txt\nadd a.txt\nadd c.txt')
  })

  it('squash keeps both messages; fixup keeps the first', async () => {
    const [a, b, c] = setup()
    expect(await run([pick(a!), { sha: b!, action: 'squash' }, { sha: c!, action: 'fixup' }])).toBe('ok')
    expect(fx.git(['log', '--format=%B', '-1']).trim()).toBe('add a.txt\n\nadd b.txt')
    expect(fx.git(['rev-parse', 'HEAD~1'])).toBe(fx.git(['rev-parse', 'origin/main']))
    expect(fx.git(['ls-files'])).toContain('c.txt')
  })

  it("squash keeps only the target's Change-Id (Gerrit takes the last one); reword then squash keeps the new message", async () => {
    fx = createRepoFixture()
    const id = (n: number) => `Change-Id: I${String(n).repeat(40)}`
    const a = fx.commitFile('a.txt', 'a\n', `A\n\n${id(1)}`)
    const b = fx.commitFile('b.txt', 'b\n', `B body\n\n${id(2)}`)
    expect(await run([pick(a), { sha: b, action: 'squash' }])).toBe('ok')
    expect(fx.git(['log', '--format=%B', '-1']).trim()).toBe(`A\n\n${id(1)}\n\nB body`)
    const c = fx.commitFile('c.txt', 'c\n', `C\n\n${id(3)}`)
    const head = fx.git(['rev-parse', 'HEAD~1'])
    expect(await run([{ sha: head, action: 'reword', message: `New\n\n${id(1)}` }, { sha: c, action: 'squash' }])).toBe('ok')
    expect(fx.git(['log', '--format=%B', '-1']).trim()).toBe(`New\n\n${id(1)}\n\nC`)
  })

  it('a rejected reword stops the rebase and is retried on continue, never skipped; an empty commit can be reworded', async () => {
    const [a, b, c] = setup()
    const hook = path.join(fx.work, '.git/hooks/commit-msg')
    writeFileSync(hook, '#!/bin/sh\ngrep -q ok "$1"\n', { mode: 0o755 })
    await expect(run([{ sha: a!, action: 'reword', message: 'bad' }, pick(b!), pick(c!)])).rejects.toThrow()
    expect(await opInProgress(fx.work, fx.env)).toBe('rebase')
    await expect(continueOp(fx.work, fx.env)).rejects.toThrow()
    expect(await opInProgress(fx.work, fx.env)).toBe('rebase')
    fx.git(['rebase', '--abort'])
    writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fx.git(['commit', '-q', '--allow-empty', '-m', 'empty'])
    const empty = fx.git(['rev-parse', 'HEAD'])
    expect(await run([pick(a!), pick(b!), pick(c!), { sha: empty, action: 'reword', message: 'still empty' }])).toBe('ok')
    expect(fx.git(['log', '--format=%s', '-1'])).toBe('still empty')
  })

  it('drops', async () => {
    const [a, b, c] = setup()
    expect(await run([pick(a!), { sha: b!, action: 'drop' }, pick(c!)])).toBe('ok')
    expect(subjects()).toBe('add c.txt\nadd a.txt')
  })

  it('drops every commit', async () => {
    const [a, b, c] = setup()
    expect(await run([a!, b!, c!].map((sha) => ({ sha, action: 'drop' as const })))).toBe('ok')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(fx.git(['rev-parse', 'origin/main']))
  })

  it('rewords with a message that would be special to a shell', async () => {
    const [a, b, c] = setup()
    const message = 'new "$(touch pwned)" `x` \'q\'\n\n# kept line\nbody'
    expect(await run([pick(a!), { sha: b!, action: 'reword', message }, pick(c!)])).toBe('ok')
    expect(fx.git(['log', '--format=%B', '-1', 'HEAD~1']).trim()).toBe(message)
    expect(subjects()).toBe(`add c.txt\nnew "$(touch pwned)" \`x\` 'q'\nadd a.txt`)
    expect(fx.git(['status', '--porcelain'])).toBe('')
  })

  it('reword after a conflict stop still applies on continue', async () => {
    fx = createRepoFixture()
    const a = fx.commitFile('f.txt', '1\n')
    const b = fx.commitFile('f.txt', '2\n')
    // Swap: b first conflicts (its parent content differs).
    expect(await run([pick(b), { sha: a, action: 'reword', message: 'reworded a' }])).toBe('conflict')
    expect(await opInProgress(fx.work, fx.env)).toBe('rebase')
    writeFileSync(path.join(fx.work, 'f.txt'), '2\n')
    fx.git(['add', 'f.txt'])
    let r = await continueOp(fx.work, fx.env)
    while (r === 'conflict') {
      writeFileSync(path.join(fx.work, 'f.txt'), '1\n')
      fx.git(['add', 'f.txt'])
      r = await continueOp(fx.work, fx.env)
    }
    expect(await opInProgress(fx.work, fx.env)).toBeNull()
    expect(fx.git(['log', '--format=%s', '-1'])).toBe('reworded a')
  })

  it('autostash keeps local changes', async () => {
    const [a, b, c] = setup()
    writeFileSync(path.join(fx.work, 'a.txt'), 'dirty\n')
    expect(await run([pick(b!), pick(a!), pick(c!)], true)).toBe('ok')
    expect(readFileSync(path.join(fx.work, 'a.txt'), 'utf8')).toBe('dirty\n')
    expect(subjects()).toBe('add c.txt\nadd a.txt\nadd b.txt')
  })

  it('refuses a stale or incomplete list, duplicates and pushed commits', async () => {
    const [a, b, c] = setup()
    const pushed = fx.git(['rev-parse', 'origin/main'])
    await expect(run([pick(a!), pick(b!)])).rejects.toThrow(/changed/)
    await expect(run([pick(a!), pick(b!), pick(b!)])).rejects.toThrow(/changed/)
    await expect(run([pick(a!), pick(b!), pick(pushed)])).rejects.toThrow(/changed/)
    await expect(run([pick(a!), pick(b!), pick(c!), pick(pushed)])).rejects.toThrow(/changed/)
    expect(subjects()).toBe('add c.txt\nadd b.txt\nadd a.txt')
  })

  it('refuses squash/fixup first, an empty reword, a merge in range and an op in progress', async () => {
    const [a, b, c] = setup()
    await expect(run([{ sha: a!, action: 'squash' }, pick(b!), pick(c!)])).rejects.toThrow(/first commit/)
    await expect(run([{ sha: a!, action: 'drop' }, { sha: b!, action: 'fixup' }, pick(c!)])).rejects.toThrow(/first commit/)
    await expect(run([pick(a!), { sha: b!, action: 'reword', message: ' ' }, pick(c!)])).rejects.toThrow(/message/)

    fx.git(['switch', '-q', '-c', 'side', 'HEAD~1'])
    const d = fx.commitFile('d.txt', 'd\n')
    fx.git(['switch', '-q', 'main'])
    fx.git(['merge', '-q', '--no-edit', 'side'])
    const all = fx.git(['rev-list', 'HEAD', '--not', '--remotes']).split('\n')
    expect(all).toContain(d)
    await expect(run(all.reverse().map(pick))).rejects.toThrow(/merge commit/)

    fx.git(['reset', '-q', '--hard', c!])
    fx.commitFile('README.md', 'ours\n')
    fx.git(['switch', '-q', 'side'])
    fx.commitFile('README.md', 'theirs\n')
    fx.git(['switch', '-q', 'main'])
    expect(() => fx.git(['merge', '-q', 'side'])).toThrow()
    await expect(run([pick(a!)])).rejects.toThrow(/in progress/)
  })
})
